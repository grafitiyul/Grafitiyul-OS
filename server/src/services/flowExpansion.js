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
  const nodes = flow.nodes || [];
  const steps = walkFlow({ nodes, bank });

  // Per-folderRef trace — surfaces "I expanded folderRef X pointing at
  // bank folder F and got N items" so a 0-step result can be traced
  // back to a specific node and a specific bank folder.
  const folderRefTrace = nodes
    .filter((n) => n.kind === 'folderRef')
    .map((n) => ({
      nodeId: n.id,
      bankFolderId: n.bankFolderId || null,
      itemsExpanded: n.bankFolderId
        ? walkBankFolder(bank, n.bankFolderId).length
        : 0,
    }));

  // Always log a one-line summary — cheap, and makes Railway logs the
  // first place to look when runtime ends up empty.
  const kindCounts = nodes.reduce(
    (acc, n) => ((acc[n.kind] = (acc[n.kind] || 0) + 1), acc),
    {},
  );
  console.log('[flowExpansion] build', {
    flowId: flow.id,
    nodeCount: nodes.length,
    kindCounts,
    folderRefTrace,
    bankSizes: {
      foldersByParent: [...bank.foldersByParent].reduce(
        (a, [, v]) => a + v.length,
        0,
      ),
      itemsByFolder: [...bank.itemsByFolder].reduce(
        (a, [, v]) => a + v.length,
        0,
      ),
    },
    stepCount: steps.length,
  });

  if (steps.length === 0 && nodes.length > 0) {
    const summary = nodes.slice(0, 12).map((n) => ({
      id: n.id,
      kind: n.kind,
      bankFolderId: n.bankFolderId || null,
      contentItemId: n.contentItemId || null,
      questionItemId: n.questionItemId || null,
      parentId: n.parentId || null,
      order: n.order,
    }));
    console.warn(
      '[flowExpansion] expansion produced 0 steps from a non-empty flow',
      { flowId: flow.id, nodeCount: nodes.length, sample: summary },
    );
  }
  return { version: EXPANSION_VERSION, steps };
}

// Public diagnostic helper — returns the bank snapshot summary along
// with the expansion so the debug endpoint can surface "what does the
// expander see right now" without callers having to reach into module-
// internal helpers.
export async function buildExpansionWithDiagnostics(prisma, flow) {
  const bank = await loadBankSnapshot(prisma);
  const nodes = flow.nodes || [];
  const steps = walkFlow({ nodes, bank });
  const folderRefTrace = nodes
    .filter((n) => n.kind === 'folderRef')
    .map((n) => {
      const items = n.bankFolderId
        ? walkBankFolder(bank, n.bankFolderId)
        : [];
      return {
        nodeId: n.id,
        bankFolderId: n.bankFolderId || null,
        itemsExpanded: items.length,
        sampleItems: items.slice(0, 8).map((i) => ({
          id: i.id,
          kind: i.kind,
          folderId: i.folderId || null,
          title:
            typeof i.title === 'string' ? i.title.slice(0, 80) : null,
        })),
      };
    });
  const bankSummary = {
    foldersTotal: [...bank.foldersByParent].reduce(
      (a, [, v]) => a + v.length,
      0,
    ),
    itemsTotal: [...bank.itemsByFolder].reduce(
      (a, [, v]) => a + v.length,
      0,
    ),
    foldersByParent: [...bank.foldersByParent].map(([k, v]) => ({
      parentId: k,
      childCount: v.length,
      childIds: v.map((f) => f.id),
    })),
    itemsByFolder: [...bank.itemsByFolder].map(([k, v]) => ({
      folderId: k,
      itemCount: v.length,
      sample: v.slice(0, 4).map((i) => ({ id: i.id, kind: i.kind })),
    })),
  };
  return {
    expansion: { version: EXPANSION_VERSION, steps },
    folderRefTrace,
    bankSummary,
  };
}

// Convenience: turn an `expansion.steps[].stepId` into the source-of-
// truth identifiers needed for answer storage / runtime rendering.
export function stepLookup(expansion, stepId) {
  if (!expansion?.steps) return null;
  return expansion.steps.find((s) => s.stepId === stepId) || null;
}

// ── Additive merge (safe re-expansion for active attempts) ────────
//
// Used by the admin "sync active attempts" action. Goal: let admin
// adds — new content items, new questions, new folderRef contents —
// reach learners who have already started, WITHOUT mutating any step
// the learner has already seen / answered.
//
// Rules, in order of priority:
//   1. NEVER drop a step from `oldSteps`. Even if the admin removed
//      the underlying flow node, the active attempt keeps it — the
//      learner may have answered it, and currentStepId may point at
//      it. Removing would invalidate the cursor and lose context.
//   2. NEVER reorder existing steps relative to each other. Old
//      ordering is the truth the learner has already navigated.
//      Admin reorders apply only to NEW attempts.
//   3. Insert each new step (present in `newSteps` but not in
//      `oldSteps`) at the position implied by `newSteps` — i.e. just
//      after the latest preceding-in-newSteps step that ALSO exists
//      in `oldSteps`. Steps with no surviving anchor go to the
//      front of the merged sequence.
//
// The result preserves old order and slots in additions in their
// natural fresh-expansion positions. Removals from the flow are
// effectively ignored for active attempts; reorders are also
// ignored. Both choices are deliberate — they're the safe defaults
// for "don't disrupt the learner".
export function mergeAdditiveExpansion(oldSteps, newSteps) {
  const oldList = Array.isArray(oldSteps) ? oldSteps : [];
  const newList = Array.isArray(newSteps) ? newSteps : [];
  if (oldList.length === 0) return [...newList];
  if (newList.length === 0) return [...oldList];

  // Tracks which step ids we've already "anchored" in the merged
  // result. Starts as the old ids and grows as we insert each new
  // step, so subsequent new steps that follow earlier new steps can
  // anchor on them.
  const anchored = new Set(oldList.map((s) => s.stepId));
  const merged = [...oldList];

  for (let i = 0; i < newList.length; i += 1) {
    const candidate = newList[i];
    if (!candidate?.stepId) continue;
    if (anchored.has(candidate.stepId)) continue;

    // Find the most recent newList entry preceding `candidate` that
    // is already anchored (i.e. exists in old or was inserted by a
    // previous iteration of this loop).
    let anchorStepId = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prior = newList[j];
      if (prior?.stepId && anchored.has(prior.stepId)) {
        anchorStepId = prior.stepId;
        break;
      }
    }

    let insertIdx;
    if (anchorStepId === null) {
      // No anchor among earlier newList entries — this candidate
      // sits at the very start of the new ordering. Place it at the
      // front so a subsequent new step that follows it can anchor.
      insertIdx = 0;
    } else {
      const at = merged.findIndex((s) => s.stepId === anchorStepId);
      insertIdx = at < 0 ? merged.length : at + 1;
    }
    merged.splice(insertIdx, 0, candidate);
    anchored.add(candidate.stepId);
  }

  return merged;
}

export const FLOW_EXPANSION_VERSION = EXPANSION_VERSION;
