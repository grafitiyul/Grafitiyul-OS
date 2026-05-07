// Flow → linear step expansion for an attempt.
//
// One pure function. Input: the flow's authoring tree (FlowNode rows
// with optional folderRef nodes) + a snapshot of the relevant bank
// data (folders / content items / question items). Output: an
// ordered list of steps the learner walks through.
//
// Each step is keyed by a stable `stepId`:
//   * non-folderRef step → stepId == FlowNode.id
//   * folderRef-derived  → stepId == `${folderRefNodeId}::${bankItemId}`
//
// Item CONTENT (title, body, options, requirement) is NOT captured in
// the expansion. It's resolved live by id at read time so typo fixes /
// wording changes propagate to in-flight attempts. Only the STRUCTURE
// (which items, in what order, under which folderRef) is frozen here.
//
// The expander is intentionally generic on its bank input: callers can
// later add `trainingPlan` / `onboardingPack` / etc. linked types by
// extending the per-node branch in `walkFlow`. Today only `folderRef`
// + `bankFolderId` is consumed.

const EXPANSION_VERSION = 1;

// Walk a bank folder tree, emitting items in (folder hierarchy →
// sortOrder) order. Mirrors the bank UI: items inside a folder before
// items inside any of its sub-folders, sub-folders walked recursively.
//
// `bank` shape:
//   {
//     foldersByParent: Map<parentId|null, ItemBankFolder[]> (sorted)
//     itemsByFolder:    Map<folderId|null, Array<{kind, ...}>>(sorted)
//   }
function walkBankFolder(bank, folderId) {
  const out = [];
  // Items directly in this folder.
  for (const item of bank.itemsByFolder.get(folderId) || []) {
    out.push(item);
  }
  // Recurse into sub-folders.
  for (const sub of bank.foldersByParent.get(folderId) || []) {
    out.push(...walkBankFolder(bank, sub.id));
  }
  return out;
}

// Walk the flow's authoring tree, producing steps. Groups are
// structural only (no learner step). folderRef nodes expand into
// bank items via walkBankFolder.
function walkFlow({ nodes, bank }) {
  const childrenByParent = new Map();
  for (const n of nodes) {
    const key = n.parentId || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(n);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  const steps = [];
  function visit(parentId) {
    for (const node of childrenByParent.get(parentId) || []) {
      if (node.kind === 'group') {
        visit(node.id);
        continue;
      }
      if (node.kind === 'folderRef') {
        if (!node.bankFolderId) continue; // dangling — skip
        // Confirm the bank folder still exists in our snapshot. If it
        // was deleted (FlowNode.bankFolder onDelete=SetNull), the
        // bankFolderId on the FlowNode is null; if the row was deleted
        // between the FK check and our query (rare), we'd still see
        // null in itemsByFolder/foldersByParent — emit nothing.
        for (const item of walkBankFolder(bank, node.bankFolderId)) {
          if (item.kind !== 'content' && item.kind !== 'question') continue;
          steps.push({
            stepId: `${node.id}::${item.id}`,
            kind: item.kind,
            flowNodeId: null,                // synthetic — no FlowNode row
            bankFolderRefId: node.id,        // origin folderRef
            contentItemId: item.kind === 'content' ? item.id : null,
            questionItemId: item.kind === 'question' ? item.id : null,
            checkpointAfter: false,          // no checkpoints inside refs
          });
        }
        continue;
      }
      if (node.kind === 'content' || node.kind === 'question') {
        steps.push({
          stepId: node.id,
          kind: node.kind,
          flowNodeId: node.id,
          bankFolderRefId: null,
          contentItemId: node.contentItemId || null,
          questionItemId: node.questionItemId || null,
          checkpointAfter: !!node.checkpointAfter,
        });
        continue;
      }
      // Unknown kind — skip defensively.
    }
  }
  visit(null);
  return steps;
}

// Build the bank index needed by the expander. Only collects what
// the referenced folders need (transitively): the function pulls
// every folder + every item, which is acceptable at bank scale.
// Larger banks could narrow this to "folders reachable from any
// folderRef in the flow", but that optimization isn't worth the
// complexity at current scale.
async function loadBankSnapshot(prisma) {
  const [folders, contentItems, questionItems] = await Promise.all([
    prisma.itemBankFolder.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.contentItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.questionItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const foldersByParent = new Map();
  for (const f of folders) {
    const key = f.parentId || null;
    if (!foldersByParent.has(key)) foldersByParent.set(key, []);
    foldersByParent.get(key).push(f);
  }
  const itemsByFolder = new Map();
  const tag = (item, kind) => ({ ...item, kind });
  for (const c of contentItems) {
    const key = c.folderId || null;
    if (!itemsByFolder.has(key)) itemsByFolder.set(key, []);
    itemsByFolder.get(key).push(tag(c, 'content'));
  }
  for (const q of questionItems) {
    const key = q.folderId || null;
    if (!itemsByFolder.has(key)) itemsByFolder.set(key, []);
    itemsByFolder.get(key).push(tag(q, 'question'));
  }
  // Mixed lists need re-sort by sortOrder so content+question interleave
  // by their actual order in the bank.
  for (const arr of itemsByFolder.values()) {
    arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  return { foldersByParent, itemsByFolder };
}

// Public API: build the expansion for an attempt.
//
//   prisma — PrismaClient
//   flow   — { nodes: FlowNode[] } (each node carries bankFolderId etc)
//
// Returns an `expansion` object suitable for the Attempt.expansion column.
export async function buildExpansion(prisma, flow) {
  const bank = await loadBankSnapshot(prisma);
  const steps = walkFlow({ nodes: flow.nodes || [], bank });
  return { version: EXPANSION_VERSION, steps };
}

// Convenience: turn an `expansion.steps[].stepId` into the source-of-
// truth identifiers needed for answer storage / runtime rendering.
export function stepLookup(expansion, stepId) {
  if (!expansion?.steps) return null;
  return expansion.steps.find((s) => s.stepId === stepId) || null;
}

export const FLOW_EXPANSION_VERSION = EXPANSION_VERSION;
