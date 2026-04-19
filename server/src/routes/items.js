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
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name_required' });
    }
    const top = await prisma.itemBankFolder.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = (top?.sortOrder ?? -1) + 1;
    const folder = await prisma.itemBankFolder.create({
      data: { name: String(name).trim(), sortOrder },
    });
    res.status(201).json(folder);
  }),
);

// Reorder MUST be declared before the generic :id PUT — Express matches in
// declaration order and would otherwise treat "reorder" as an id.
router.put(
  '/folders/reorder',
  handle(async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_array_required' });
    await reindexByIds(prisma.itemBankFolder, ids);
    res.json({ ok: true });
  }),
);

router.put(
  '/folders/:id',
  handle(async (req, res) => {
    const { name } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    const folder = await prisma.itemBankFolder.update({
      where: { id: req.params.id },
      data,
    });
    res.json(folder);
  }),
);

// Deleting a folder unsets folderId on its items (ON DELETE SET NULL) so
// no items are lost.
router.delete(
  '/folders/:id',
  handle(async (req, res) => {
    await prisma.itemBankFolder.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Unified cross-kind reorder. Body: { ordered: [{ kind, id }, ...], folderId? }.
// Reassigns sortOrder across BOTH content and question tables so the bank
// list's drag order is respected exactly as shown — no forced alternation
// by kind. Atomic under a single $transaction.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const { ordered, folderId = null } = req.body || {};
    if (!Array.isArray(ordered)) {
      return res.status(400).json({ error: 'ordered_array_required' });
    }
    const scopeFolder = folderId === undefined ? undefined : folderId || null;
    const ops = ordered.map((entry, index) => {
      const { kind, id } = entry || {};
      if (kind === 'content') {
        return prisma.contentItem.updateMany({
          where: {
            id,
            ...(scopeFolder === undefined ? {} : { folderId: scopeFolder }),
          },
          data: { sortOrder: index },
        });
      }
      if (kind === 'question') {
        return prisma.questionItem.updateMany({
          where: {
            id,
            ...(scopeFolder === undefined ? {} : { folderId: scopeFolder }),
          },
          data: { sortOrder: index },
        });
      }
      return prisma.$queryRaw`SELECT 1`; // no-op placeholder for unknown kinds
    });
    await prisma.$transaction(ops);
    res.json({ ok: true });
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

router.post(
  '/questions',
  handle(async (req, res) => {
    const {
      title = '',
      questionText = '',
      answerType = 'open_text',
      options = [],
      internalNote = null,
      folderId = null,
    } = req.body || {};
    if (!['open_text', 'single_choice'].includes(answerType)) {
      return res.status(400).json({ error: 'invalid answerType' });
    }
    const sortOrder = await nextSortOrder(prisma.questionItem, folderId);
    const item = await prisma.questionItem.create({
      data: {
        title: String(title || ''),
        questionText,
        answerType,
        options,
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
    const { title, questionText, answerType, options, internalNote, folderId } =
      req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (questionText !== undefined) data.questionText = questionText;
    if (answerType !== undefined) data.answerType = answerType;
    if (options !== undefined) data.options = options;
    if (internalNote !== undefined) data.internalNote = internalNote;
    if (folderId !== undefined) data.folderId = folderId || null;
    const item = await prisma.questionItem.update({
      where: { id: req.params.id },
      data,
    });
    res.json(item);
  }),
);

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
