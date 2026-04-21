import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

// Default ordering rule (set by the procedures module UX pass):
//   oldest first, new items appended at the bottom.
//   sortOrder ASC is the primary key; createdAt ASC is the tie-breaker so
//   two rows created quickly still have deterministic ordering.
const LIST_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }];

// Reorder helper — reindexes a list of ids atomically. Used by both content
// and question reorder endpoints plus folder reorder. `ids` is the new order;
// rows not in `ids` keep their existing sortOrder.
async function reindexByIds(model, ids, scope = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await prisma.$transaction(
    ids.map((id, index) =>
      model.updateMany({
        where: { id, ...scope },
        data: { sortOrder: index },
      }),
    ),
  );
}

// Next sortOrder for an append, GLOBAL across content + question in the
// same folder. sortOrder is a single monotonic index per folder shared by
// both tables so there are no ties between them — the bank list orders
// purely by sortOrder, with no hidden tie-breaker that would look like
// forced alternation.
async function nextSortOrder(_unusedModel, folderId) {
  const scope = { folderId: folderId ?? null };
  const [topContent, topQuestion] = await Promise.all([
    prisma.contentItem.findFirst({
      where: scope,
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    }),
    prisma.questionItem.findFirst({
      where: scope,
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    }),
  ]);
  const maxContent = topContent?.sortOrder ?? -1;
  const maxQuestion = topQuestion?.sortOrder ?? -1;
  return Math.max(maxContent, maxQuestion) + 1;
}

// ---------- Item bank folders ----------
// Nested: each folder has an optional parentId. sortOrder is scoped per
// parent, so reindexing only touches siblings in the same parent.

// List ALL folders (flat). The client derives the tree in memory via
// parentId — no need for a separate /tree endpoint; flat is cheaper and
// avoids duplicated representations.
router.get(
  '/folders',
  handle(async (_req, res) => {
    const folders = await prisma.itemBankFolder.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(folders);
  }),
);

router.post(
  '/folders',
  handle(async (req, res) => {
    const { name, parentId = null } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name_required' });
    }
    const scope = { parentId: parentId || null };
    const top = await prisma.itemBankFolder.findFirst({
      where: scope,
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = (top?.sortOrder ?? -1) + 1;
    const folder = await prisma.itemBankFolder.create({
      data: {
        name: String(name).trim(),
        parentId: parentId || null,
        sortOrder,
      },
    });
    res.status(201).json(folder);
  }),
);

// Reorder MUST be declared before the generic :id PUT — Express matches in
// declaration order and would otherwise treat "reorder" as an id.
//
// Atomic parent-scoped reorder. Callers pass the full ordered children
// of ONE parent plus the target parentId. The transaction sets BOTH
// parentId and sortOrder on every id — so this endpoint handles both
// same-parent reorder AND cross-parent folder moves in one call (the
// same pattern as /reorder for items).
//
// Cycle prevention is left to the client today (it already computes
// descendants on drag). We could add a server check that rejects any
// id whose subtree contains `parentId`, but the extra round trips
// would be noticeable at UI scale.
router.put(
  '/folders/reorder',
  handle(async (req, res) => {
    const { ids, parentId = null } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_array_required' });
    const parent = parentId || null;
    try {
      await prisma.$transaction(
        ids.map((id, index) =>
          prisma.itemBankFolder.updateMany({
            where: { id },
            data: { parentId: parent, sortOrder: index },
          }),
        ),
      );
      res.json({ ok: true });
    } catch (e) {
      // Surface the ACTUAL failure to the client instead of letting it
      // flow into the generic 500 handler. The browser console trace
      // picks this up and tells us exactly what the DB / Prisma layer
      // rejected (missing column, FK violation, type mismatch, etc).
      console.error('[folders/reorder] failed', {
        message: e?.message,
        code: e?.code,
        meta: e?.meta,
        name: e?.name,
        ids,
        parentId,
      });
      return res.status(500).json({
        error: 'folders_reorder_failed',
        message: e?.message || String(e),
        code: e?.code || null,
        meta: e?.meta || null,
        name: e?.name || null,
      });
    }
  }),
);

// Update folder. Supports renaming AND moving under a new parent in one
// call. Moving to a new parent recomputes sortOrder to append at the end
// of the new parent's children (the client can follow up with a reorder
// if a more specific position is needed).
//
// Cycle prevention: a folder may not be moved under itself or any of its
// descendants. We do a server-side walk up the ancestor chain from the
// proposed parent; if we hit the folder being moved, reject.
router.put(
  '/folders/:id',
  handle(async (req, res) => {
    const id = req.params.id;
    const { name, parentId } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();

    if (parentId !== undefined) {
      const nextParent = parentId || null;
      if (nextParent === id) {
        return res.status(400).json({ error: 'cannot_parent_self' });
      }
      if (nextParent) {
        // Walk ancestors of nextParent — if any is `id`, we'd form a cycle.
        let cursor = nextParent;
        const seen = new Set();
        while (cursor) {
          if (cursor === id) {
            return res.status(400).json({ error: 'cycle_detected' });
          }
          if (seen.has(cursor)) break; // safety: malformed tree
          seen.add(cursor);
          const f = await prisma.itemBankFolder.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
          if (!f) break;
          cursor = f.parentId || null;
        }
      }
      data.parentId = nextParent;
      // Append at end of new parent's children (next sortOrder). If the
      // parent hasn't changed this is a no-op on position; the client can
      // reorder after if needed.
      const top = await prisma.itemBankFolder.findFirst({
        where: { parentId: nextParent },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      data.sortOrder = (top?.sortOrder ?? -1) + 1;
    }

    const folder = await prisma.itemBankFolder.update({
      where: { id },
      data,
    });
    res.json(folder);
  }),
);

// Deleting a folder unsets folderId on its items (ON DELETE SET NULL) so
// no items are lost, and sets parentId=null on any child folders so they
// float up to root (the self-relation also uses ON DELETE SET NULL).
router.delete(
  '/folders/:id',
  handle(async (req, res) => {
    await prisma.itemBankFolder.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Unified cross-kind reorder. Body: { ordered: [{ kind, id }, ...], folderId? }.
// Atomically:
//   1. moves every item in `ordered` INTO the target folder
//   2. reassigns sortOrder by position in the `ordered` array
// Handles same-folder reorder AND cross-folder drag in one call — the
// client builds the full ordered list for the target folder (with the
// dragged item inserted at the drop position), and this endpoint both
// sets folderId + sortOrder atomically, so there is no "item silently
// skipped because its current folderId did not match the scope" bug.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const { ordered, folderId = null } = req.body || {};
    if (!Array.isArray(ordered)) {
      return res.status(400).json({ error: 'ordered_array_required' });
    }
    const scopeFolder = folderId === undefined ? undefined : folderId || null;
    // One updateMany per entry. Unknown kinds are skipped entirely — no
    // placeholder query, no side effects. The where clause scopes ONLY by
    // id (not folderId) so this endpoint can also MOVE items into the
    // target folder — which is exactly what cross-folder drags require.
    // The data payload always sets sortOrder; if scopeFolder is defined
    // (the normal path), it also sets folderId so the item ends up in
    // the right folder even when it started in a different one.
    const ops = [];
    ordered.forEach((entry, index) => {
      const kind = entry?.kind;
      const id = entry?.id;
      if (!id) return;
      const data = { sortOrder: index };
      if (scopeFolder !== undefined) data.folderId = scopeFolder;
      if (kind === 'content') {
        ops.push(
          prisma.contentItem.updateMany({ where: { id }, data }),
        );
      } else if (kind === 'question') {
        ops.push(
          prisma.questionItem.updateMany({ where: { id }, data }),
        );
      }
    });
    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }
    res.json({ ok: true, count: ops.length });
  }),
);

// ---------- Content items ----------

router.get(
  '/content',
  handle(async (_req, res) => {
    const items = await prisma.contentItem.findMany({ orderBy: LIST_ORDER });
    res.json(items);
  }),
);

// Reorder MUST be declared before the generic :id PUT — Express matches in
// declaration order.
router.put(
  '/content/reorder',
  handle(async (req, res) => {
    const { ids, folderId = null } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_array_required' });
    const scope = folderId === undefined ? {} : { folderId: folderId || null };
    await reindexByIds(prisma.contentItem, ids, scope);
    res.json({ ok: true });
  }),
);

router.get(
  '/content/:id',
  handle(async (req, res) => {
    const item = await prisma.contentItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  }),
);

router.get(
  '/content/:id/usage',
  handle(async (req, res) => {
    const flows = await prisma.flow.findMany({
      where: { nodes: { some: { contentItemId: req.params.id } } },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
    res.json(flows);
  }),
);

router.post(
  '/content',
  handle(async (req, res) => {
    // Autosave flow pre-creates rows immediately so the user's work is on
    // the server from the first keystroke — empty title is allowed at
    // creation time. The bank list renders these as "(ללא כותרת)" until
    // the user types one.
    const {
      title = '',
      body = '',
      internalNote = null,
      folderId = null,
    } = req.body || {};
    const sortOrder = await nextSortOrder(prisma.contentItem, folderId);
    const item = await prisma.contentItem.create({
      data: {
        title: String(title || ''),
        body,
        internalNote,
        folderId: folderId || null,
        sortOrder,
      },
    });
    res.status(201).json(item);
  }),
);

router.put(
  '/content/:id',
  handle(async (req, res) => {
    const { title, body, internalNote, folderId } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (body !== undefined) data.body = body;
    if (internalNote !== undefined) data.internalNote = internalNote;
    if (folderId !== undefined) data.folderId = folderId || null;
    const item = await prisma.contentItem.update({
      where: { id: req.params.id },
      data,
    });
    res.json(item);
  }),
);

router.delete(
  '/content/:id',
  handle(async (req, res) => {
    try {
      await prisma.contentItem.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ error: 'Cannot delete — item is used in a flow.' });
    }
  }),
);

// Move a single content item to a folder (or root when folderId is null).
// Appends at the end of that folder's list.
router.put(
  '/content/:id/move',
  handle(async (req, res) => {
    const targetFolderId = req.body?.folderId || null;
    const sortOrder = await nextSortOrder(prisma.contentItem, targetFolderId);
    const item = await prisma.contentItem.update({
      where: { id: req.params.id },
      data: { folderId: targetFolderId, sortOrder },
    });
    res.json(item);
  }),
);

// ---------- Question items ----------

router.get(
  '/questions',
  handle(async (_req, res) => {
    const items = await prisma.questionItem.findMany({ orderBy: LIST_ORDER });
    res.json(items);
  }),
);

// Reorder MUST be declared before the generic :id PUT.
router.put(
  '/questions/reorder',
  handle(async (req, res) => {
    const { ids, folderId = null } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_array_required' });
    const scope = folderId === undefined ? {} : { folderId: folderId || null };
    await reindexByIds(prisma.questionItem, ids, scope);
    res.json({ ok: true });
  }),
);

router.get(
  '/questions/:id',
  handle(async (req, res) => {
    const item = await prisma.questionItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  }),
);

router.get(
  '/questions/:id/usage',
  handle(async (req, res) => {
    const flows = await prisma.flow.findMany({
      where: { nodes: { some: { questionItemId: req.params.id } } },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
    res.json(flows);
  }),
);

// Unified question model. See server/src/services/questionRequirement.js
// for the shape of `requirement`. `answerType` is still written on create
// so the deprecated column stays valid during the rollback window, but
// all new behaviour reads allowTextAnswer + requirement.
router.post(
  '/questions',
  handle(async (req, res) => {
    const {
      title = '',
      questionText = '',
      options = [],
      allowTextAnswer = true,
      requirement = 'optional',
      internalNote = null,
      folderId = null,
    } = req.body || {};
    if (!Array.isArray(options)) {
      return res.status(400).json({ error: 'invalid options' });
    }
    if (!REQUIREMENT_VALUES.has(String(requirement))) {
      return res.status(400).json({ error: 'invalid requirement' });
    }
    const sortOrder = await nextSortOrder(prisma.questionItem, folderId);
    const item = await prisma.questionItem.create({
      data: {
        title: String(title || ''),
        questionText,
        // answerType mirror, derived from the new shape so pre-rollback
        // reads of the deprecated column remain sensible. Removed in a
        // follow-up slice.
        answerType: deriveLegacyAnswerType({ options, allowTextAnswer }),
        options,
        allowTextAnswer: !!allowTextAnswer,
        requirement: String(requirement),
        internalNote,
        folderId: folderId || null,
        sortOrder,
      },
    });
    res.status(201).json(item);
  }),
);

router.put(
  '/questions/:id',
  handle(async (req, res) => {
    const {
      title,
      questionText,
      options,
      allowTextAnswer,
      requirement,
      internalNote,
      folderId,
    } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (questionText !== undefined) data.questionText = questionText;
    if (options !== undefined) {
      if (!Array.isArray(options)) {
        return res.status(400).json({ error: 'invalid options' });
      }
      data.options = options;
    }
    if (allowTextAnswer !== undefined) data.allowTextAnswer = !!allowTextAnswer;
    if (requirement !== undefined) {
      if (!REQUIREMENT_VALUES.has(String(requirement))) {
        return res.status(400).json({ error: 'invalid requirement' });
      }
      data.requirement = String(requirement);
    }
    if (internalNote !== undefined) data.internalNote = internalNote;
    if (folderId !== undefined) data.folderId = folderId || null;

    // Keep the deprecated answerType mirror in sync if any of the
    // fields that derive it changed. Drops out in the cleanup slice.
    if (options !== undefined || allowTextAnswer !== undefined) {
      // We need the current values to derive: use whatever the caller
      // just passed, and fall back to reading the row only when neither
      // was sent (never happens here because we're inside this branch).
      const current = await prisma.questionItem.findUnique({
        where: { id: req.params.id },
        select: { options: true, allowTextAnswer: true },
      });
      data.answerType = deriveLegacyAnswerType({
        options: options !== undefined ? options : current?.options || [],
        allowTextAnswer:
          allowTextAnswer !== undefined
            ? !!allowTextAnswer
            : !!current?.allowTextAnswer,
      });
    }

    const item = await prisma.questionItem.update({
      where: { id: req.params.id },
      data,
    });
    res.json(item);
  }),
);

// --- Local helpers ---

// Map the new unified shape back to the old binary answerType so the
// deprecated column stays meaningful until the rollback window closes.
//   has choices only       → single_choice
//   has text only          → open_text
//   both, or neither       → open_text (most permissive default)
function deriveLegacyAnswerType({ options, allowTextAnswer }) {
  const hasChoices = Array.isArray(options) && options.length > 0;
  if (hasChoices && !allowTextAnswer) return 'single_choice';
  return 'open_text';
}

const REQUIREMENT_VALUES = new Set([
  'optional',
  'choice',
  'text',
  'any',
  'both',
]);

router.delete(
  '/questions/:id',
  handle(async (req, res) => {
    try {
      await prisma.questionItem.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ error: 'Cannot delete — item is used in a flow.' });
    }
  }),
);

router.put(
  '/questions/:id/move',
  handle(async (req, res) => {
    const targetFolderId = req.body?.folderId || null;
    const sortOrder = await nextSortOrder(prisma.questionItem, targetFolderId);
    const item = await prisma.questionItem.update({
      where: { id: req.params.id },
      data: { folderId: targetFolderId, sortOrder },
    });
    res.json(item);
  }),
);

export default router;
