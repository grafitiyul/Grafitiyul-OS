import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Reusable Timeline / Activity-Feed API. Every item is a TimelineEntry scoped to
// a subject via (subjectType, subjectId) — so the SAME endpoints serve Deals,
// Contacts, Organizations and future modules. V1 supports the 'note' kind (rich
// HTML) + comments + pin/manual-ordering. Other kinds (activity/email/whatsapp/
// file/system_event) are intentionally not creatable yet, but the shape already
// expects them.

const router = Router();

// Subjects the timeline may attach to. Extend as modules adopt it (contact /
// organization are ready for when their pages embed the same component).
const VALID_SUBJECTS = ['deal', 'contact', 'organization'];
// Creatable kinds in V1. The schema/feed already tolerate more.
const VALID_KINDS = ['note'];

const ENTRY_INCLUDE = {
  comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
};

function reloadEntry(id) {
  return prisma.timelineEntry.findUnique({ where: { id }, include: ENTRY_INCLUDE });
}

// Non-human origin types. 'user' is handled separately (it needs an AdminUser).
const NON_USER_ACTORS = ['api', 'automation', 'system', 'import'];

// Resolve the explicit, NON-anonymous origin of a timeline write and return the
// actor fields to persist — or an { error } the caller turns into a 400.
//
//   • An explicit non-user source in the body (`source: { actorType, actorLabel }`)
//     is honoured first — this is how future API integrations / automations /
//     system events / imports attribute themselves (they need not be logged in).
//   • Otherwise a logged-in admin becomes the 'user' origin (id + username snapshot).
//   • Neither a source nor a user → rejected. Nothing is ever anonymous.
async function resolveOrigin(req) {
  const src = req.body?.source;
  if (src && typeof src === 'object' && src.actorType && src.actorType !== 'user') {
    if (!NON_USER_ACTORS.includes(src.actorType)) return { error: 'invalid_actor_type' };
    const actorLabel = String(src.actorLabel || '').trim();
    if (!actorLabel) return { error: 'origin_label_required' };
    return { fields: { actorType: src.actorType, actorLabel, createdBy: null, createdByName: null } };
  }
  const userId = req.adminAuth?.userId || null;
  if (userId) {
    const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
    return { fields: { actorType: 'user', actorLabel: null, createdBy: userId, createdByName: u?.username || null } };
  }
  return { error: 'origin_required' };
}

// ---------- Entries ----------

// GET /api/timeline?subjectType=&subjectId=  → all live entries, newest first.
router.get(
  '/',
  handle(async (req, res) => {
    const subjectType = String(req.query.subjectType || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    if (!VALID_SUBJECTS.includes(subjectType) || !subjectId) {
      return res.status(400).json({ error: 'invalid_subject' });
    }
    const entries = await prisma.timelineEntry.findMany({
      where: { subjectType, subjectId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: ENTRY_INCLUDE,
    });
    res.json(entries);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const subjectType = String(b.subjectType || '').trim();
    const subjectId = String(b.subjectId || '').trim();
    if (!VALID_SUBJECTS.includes(subjectType) || !subjectId) {
      return res.status(400).json({ error: 'invalid_subject' });
    }
    const kind = b.kind ? String(b.kind) : 'note';
    if (!VALID_KINDS.includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
    const body = b.body != null ? String(b.body) : null;
    if (kind === 'note' && (!body || !body.trim())) {
      return res.status(400).json({ error: 'empty_note' });
    }
    const origin = await resolveOrigin(req);
    if (origin.error) return res.status(400).json({ error: origin.error });
    const entry = await prisma.timelineEntry.create({
      data: {
        subjectType,
        subjectId,
        kind,
        body,
        // Light, kind-specific payload (e.g. { origin: 'inquiry' }). Stored as-is.
        data: b.data ?? undefined,
        ...origin.fields,
      },
      include: ENTRY_INCLUDE,
    });
    res.status(201).json(entry);
  }),
);

// PUT /api/timeline/:id — edit content (body). System entries are immutable.
router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.timelineEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, deletedAt: true, isSystem: true },
    });
    if (!existing || existing.deletedAt) return res.status(404).json({ error: 'not_found' });
    if (existing.isSystem) return res.status(403).json({ error: 'system_immutable' });

    const data = {};
    if (b.body !== undefined) {
      const body = b.body != null ? String(b.body) : null;
      if (!body || !body.trim()) return res.status(400).json({ error: 'empty_note' });
      data.body = body;
      data.editedAt = new Date();
    }
    const entry = await prisma.timelineEntry.update({
      where: { id: req.params.id },
      data,
      include: ENTRY_INCLUDE,
    });
    res.json(entry);
  }),
);

// DELETE /api/timeline/:id — soft delete (also unpins).
router.delete(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.timelineEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, isSystem: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) return res.status(404).json({ error: 'not_found' });
    if (existing.isSystem) return res.status(403).json({ error: 'system_immutable' });
    await prisma.timelineEntry.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), isPinned: false },
    });
    res.status(204).end();
  }),
);

// ---------- Pinning / FOCUS ordering ----------

// POST /api/timeline/:id/pin — { pinned }. Pinning appends to the end of the
// subject's FOCUS order (manual order is preserved; newest pinned is NOT first).
router.post(
  '/:id/pin',
  handle(async (req, res) => {
    const pinned = !!req.body?.pinned;
    const entry = await prisma.timelineEntry.findUnique({ where: { id: req.params.id } });
    if (!entry || entry.deletedAt) return res.status(404).json({ error: 'not_found' });

    let pinSortOrder = entry.pinSortOrder;
    if (pinned && !entry.isPinned) {
      const last = await prisma.timelineEntry.findFirst({
        where: {
          subjectType: entry.subjectType,
          subjectId: entry.subjectId,
          isPinned: true,
          deletedAt: null,
        },
        orderBy: { pinSortOrder: 'desc' },
        select: { pinSortOrder: true },
      });
      pinSortOrder = (last?.pinSortOrder ?? -1) + 1;
    }
    const updated = await prisma.timelineEntry.update({
      where: { id: entry.id },
      data: { isPinned: pinned, pinSortOrder },
      include: ENTRY_INCLUDE,
    });
    res.json(updated);
  }),
);

// PUT /api/timeline/pins/reorder — { subjectType, subjectId, ids } in new order.
// Declared before '/:id' style routes is unnecessary (distinct path), but the
// id list is reindexed to 0..n within the subject (same pattern as catalog
// reorders elsewhere in GOS).
router.put(
  '/pins/reorder',
  handle(async (req, res) => {
    const subjectType = String(req.body?.subjectType || '').trim();
    const subjectId = String(req.body?.subjectId || '').trim();
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!VALID_SUBJECTS.includes(subjectType) || !subjectId) {
      return res.status(400).json({ error: 'invalid_subject' });
    }
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.timelineEntry.updateMany({
          where: { id, subjectType, subjectId },
          data: { pinSortOrder: i },
        }),
      ),
    );
    res.json({ ok: true });
  }),
);

// ---------- Comments ----------
// Comment mutations return the full parent entry (with comments) so the client
// can replace it in place.

router.post(
  '/:id/comments',
  handle(async (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'empty_comment' });
    const entry = await prisma.timelineEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, deletedAt: true },
    });
    if (!entry || entry.deletedAt) return res.status(404).json({ error: 'not_found' });
    const origin = await resolveOrigin(req);
    if (origin.error) return res.status(400).json({ error: origin.error });
    await prisma.timelineComment.create({ data: { entryId: entry.id, body, ...origin.fields } });
    res.status(201).json(await reloadEntry(entry.id));
  }),
);

router.put(
  '/comments/:commentId',
  handle(async (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'empty_comment' });
    const c = await prisma.timelineComment.findUnique({ where: { id: req.params.commentId } });
    if (!c || c.deletedAt) return res.status(404).json({ error: 'not_found' });
    await prisma.timelineComment.update({ where: { id: c.id }, data: { body } });
    res.json(await reloadEntry(c.entryId));
  }),
);

router.delete(
  '/comments/:commentId',
  handle(async (req, res) => {
    const c = await prisma.timelineComment.findUnique({ where: { id: req.params.commentId } });
    if (!c || c.deletedAt) return res.status(404).json({ error: 'not_found' });
    await prisma.timelineComment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    res.json(await reloadEntry(c.entryId));
  }),
);

export default router;
