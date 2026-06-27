import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { fetchHolidayRows } from '../services/hebcal.js';

// שעות שבת וחג — the source of truth for when a date/time counts as שבת / חג /
// ערב חג. Weekly recurring windows + dated holiday rows (imported via Hebcal or
// added manually) with a review/approval workflow. NOT wired to pricing yet.
// Admin-only.

const router = Router();

const HOLIDAY_TYPES = ['erev_chag', 'chag', 'other'];

function toInt(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
const clampMinute = (v) => {
  const n = toInt(v);
  return n == null ? null : Math.max(0, Math.min(1439, n));
};
// "YYYY-MM-DD" → Date at UTC midnight (for @db.Date columns).
const toDate = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null);

// ── Weekly rules ────────────────────────────────────────────────────────────

router.get(
  '/weekly',
  handle(async (_req, res) => {
    res.json(await prisma.sabbathWeeklyRule.findMany({ orderBy: { sortOrder: 'asc' } }));
  }),
);

router.put(
  '/weekly/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) => prisma.sabbathWeeklyRule.update({ where: { id }, data: { sortOrder: i } })),
    );
    res.json({ ok: true });
  }),
);

function weeklyData(b) {
  const allDay = !!b.allDay;
  return {
    nameHe: String(b.nameHe || '').trim(),
    nameEn: b.nameEn ? String(b.nameEn).trim() : null,
    dayOfWeek: Math.max(0, Math.min(6, toInt(b.dayOfWeek) ?? 0)),
    allDay,
    startMinute: allDay ? null : clampMinute(b.startMinute),
    endMinute: allDay ? null : clampMinute(b.endMinute),
    active: b.active !== false,
  };
}

router.post(
  '/weekly',
  handle(async (req, res) => {
    const data = weeklyData(req.body || {});
    if (!data.nameHe) return res.status(400).json({ error: 'name_required' });
    const last = await prisma.sabbathWeeklyRule.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    res.status(201).json(await prisma.sabbathWeeklyRule.create({ data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } }));
  }),
);

router.put(
  '/weekly/:id',
  handle(async (req, res) => {
    res.json(await prisma.sabbathWeeklyRule.update({ where: { id: req.params.id }, data: weeklyData(req.body || {}) }));
  }),
);

router.delete(
  '/weekly/:id',
  handle(async (req, res) => {
    await prisma.sabbathWeeklyRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Holiday rules ───────────────────────────────────────────────────────────

router.get(
  '/holidays',
  handle(async (req, res) => {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    res.json(await prisma.holidayRule.findMany({ where, orderBy: [{ date: 'asc' }, { type: 'asc' }] }));
  }),
);

// Manual special day.
router.post(
  '/holidays',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    if (!b.date) return res.status(400).json({ error: 'date_required' });
    const allDay = b.allDay !== false;
    const created = await prisma.holidayRule.create({
      data: {
        nameHe,
        nameEn: b.nameEn ? String(b.nameEn).trim() : null,
        date: toDate(b.date),
        allDay,
        startMinute: allDay ? null : clampMinute(b.startMinute),
        endMinute: allDay ? null : clampMinute(b.endMinute),
        type: HOLIDAY_TYPES.includes(b.type) ? b.type : 'other',
        source: 'manual',
        status: 'approved', // a manually-added day is intentional → approved
        active: true,
        reviewedAt: new Date(),
        reviewedBy: req.adminAuth?.userId || null,
      },
    });
    res.status(201).json(created);
  }),
);

// Edit a holiday → marks manuallyEdited so future imports won't overwrite it.
router.put(
  '/holidays/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = { manuallyEdited: true };
    if (b.nameHe !== undefined) data.nameHe = String(b.nameHe).trim();
    if (b.nameEn !== undefined) data.nameEn = b.nameEn ? String(b.nameEn).trim() : null;
    if (b.date !== undefined) data.date = toDate(b.date);
    if (b.type !== undefined) data.type = HOLIDAY_TYPES.includes(b.type) ? b.type : 'other';
    if (b.allDay !== undefined) {
      data.allDay = !!b.allDay;
      data.startMinute = b.allDay ? null : clampMinute(b.startMinute);
      data.endMinute = b.allDay ? null : clampMinute(b.endMinute);
    } else {
      if (b.startMinute !== undefined) data.startMinute = clampMinute(b.startMinute);
      if (b.endMinute !== undefined) data.endMinute = clampMinute(b.endMinute);
    }
    res.json(await prisma.holidayRule.update({ where: { id: req.params.id }, data }));
  }),
);

// Review action: approve | ignore | pending.
router.post(
  '/holidays/:id/review',
  handle(async (req, res) => {
    const action = String(req.body?.action || '');
    let data;
    if (action === 'approve') data = { status: 'approved', active: true, reviewedAt: new Date(), reviewedBy: req.adminAuth?.userId || null };
    else if (action === 'ignore') data = { status: 'ignored', active: false, reviewedAt: new Date(), reviewedBy: req.adminAuth?.userId || null };
    else if (action === 'pending') data = { status: 'pending', active: true };
    else return res.status(400).json({ error: 'bad_action' });
    res.json(await prisma.holidayRule.update({ where: { id: req.params.id }, data }));
  }),
);

router.delete(
  '/holidays/:id',
  handle(async (req, res) => {
    await prisma.holidayRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Import upcoming holidays from Hebcal (manual trigger). Upserts by externalId.
// NEVER overwrites an approved or manually-edited row — only refreshes the
// source mirror on those. Refreshes safe fields on still-pending/unedited rows.
// Adds new future holidays. Never deletes.
router.post(
  '/holidays/import',
  handle(async (req, res) => {
    const months = Math.max(1, Math.min(24, toInt(req.body?.months) ?? 12));
    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + months);
    const startISO = start.toISOString().slice(0, 10);
    const endISO = end.toISOString().slice(0, 10);

    let rows;
    try {
      ({ rows } = await fetchHolidayRows({ startISO, endISO }));
    } catch (e) {
      // Fail safe — change nothing, report a clear code.
      return res.status(502).json({ error: e.code || 'import_failed' });
    }

    let created = 0, refreshed = 0, locked = 0;
    for (const r of rows) {
      const mirror = { sourceName: r.sourceName, sourceDate: toDate(r.date) };
      const existing = await prisma.holidayRule.findUnique({
        where: { source_externalId: { source: 'imported', externalId: r.externalId } },
      });
      if (!existing) {
        await prisma.holidayRule.create({
          data: {
            nameHe: r.nameHe, nameEn: r.nameEn, date: toDate(r.date), type: r.type,
            allDay: r.allDay, startMinute: r.startMinute, endMinute: r.endMinute,
            source: 'imported', status: 'pending', active: true,
            externalId: r.externalId, ...mirror,
          },
        });
        created++;
      } else if (existing.status === 'approved' || existing.manuallyEdited) {
        // Locked: refresh only the source mirror (lets the UI flag drift), never
        // the owner-facing fields/status.
        await prisma.holidayRule.update({ where: { id: existing.id }, data: mirror });
        locked++;
      } else {
        // Still pending & unedited → safe to refresh from source.
        await prisma.holidayRule.update({
          where: { id: existing.id },
          data: {
            nameHe: r.nameHe, nameEn: r.nameEn, date: toDate(r.date), type: r.type,
            allDay: r.allDay, startMinute: r.startMinute, endMinute: r.endMinute, ...mirror,
          },
        });
        refreshed++;
      }
    }
    res.json({ ok: true, range: { startISO, endISO }, fetched: rows.length, created, refreshed, locked });
  }),
);

export default router;
