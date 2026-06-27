import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { fetchHolidayRows } from '../services/hebcal.js';
import { markPatch, planImport, ruleFromRow, normalizeHolidayKey } from '../services/holidayClassify.js';

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

// Carry an imported holiday's reviewed classification forward to future years.
// Keyed by the stable source name; manual rows (no source name) get no rule.
async function upsertClassification(row) {
  if (row.source !== 'imported' || !row.sourceName) return;
  const key = normalizeHolidayKey(row.sourceName);
  if (!key) return;
  await prisma.holidayClassificationRule.upsert({
    where: { source_normalizedHolidayKey: { source: row.source, normalizedHolidayKey: key } },
    update: ruleFromRow(row),
    create: { source: row.source, normalizedHolidayKey: key, ...ruleFromRow(row) },
  });
}

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
    const updated = await prisma.holidayRule.update({ where: { id: req.params.id }, data });
    // A manual edit of type/times is also a classification decision → carry it
    // forward to future years (imported rows only).
    if (b.type !== undefined || b.allDay !== undefined || b.startMinute !== undefined || b.endMinute !== undefined) {
      await upsertClassification(updated);
    }
    res.json(updated);
  }),
);

// Review action. The two "mark as …" actions both APPROVE and classify, and
// store a classification rule so future years inherit the same decision:
//   mark_chag → חג (all-day)        mark_erev → ערב חג (15:00 → end of day)
// Plus ignore / pending. (Legacy 'approve' = approve without changing type.)
router.post(
  '/holidays/:id/review',
  handle(async (req, res) => {
    const action = String(req.body?.action || '');
    const reviewer = { reviewedAt: new Date(), reviewedBy: req.adminAuth?.userId || null };
    const mark = markPatch(action);
    let data;
    if (mark) data = { ...mark, ...reviewer };
    else if (action === 'approve') data = { status: 'approved', active: true, ...reviewer };
    else if (action === 'ignore') data = { status: 'ignored', active: false, ...reviewer };
    else if (action === 'pending') data = { status: 'pending', active: true };
    else return res.status(400).json({ error: 'bad_action' });

    const updated = await prisma.holidayRule.update({ where: { id: req.params.id }, data });
    if (mark) await upsertClassification(updated); // future years inherit חג/ערב חג
    res.json(updated);
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
// NEVER overwrites an approved or manually-edited row — only refreshes the source
// mirror on those. New / still-pending rows refresh from source AND inherit a
// stored classification rule (same holiday in future years auto-gets its reviewed
// type/times and is auto-approved). Idempotent; never deletes. The decision logic
// is the pure planImport() (unit-tested).
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

    const ruleRows = await prisma.holidayClassificationRule.findMany({
      where: { source: 'imported', active: true },
    });
    const ruleByKey = new Map(ruleRows.map((r) => [r.normalizedHolidayKey, r]));

    // DB-bound dates; planImport works in ISO strings.
    const toDbData = (d) => {
      const out = { ...d };
      if (out.date) out.date = toDate(out.date);
      if (out.sourceDate) out.sourceDate = toDate(out.sourceDate);
      if (out.reviewedBy === 'system' && out.status === 'approved') out.reviewedAt = new Date();
      return out;
    };

    let created = 0, refreshed = 0, locked = 0, autoClassified = 0;
    for (const r of rows) {
      const existing = await prisma.holidayRule.findUnique({
        where: { source_externalId: { source: 'imported', externalId: r.externalId } },
      });
      const rule = ruleByKey.get(normalizeHolidayKey(r.sourceName)) || null;
      const plan = planImport({ existing, fetched: r, rule });
      const data = toDbData(plan.data);

      if (plan.op === 'create') {
        await prisma.holidayRule.create({ data });
        created++;
        if (data.status === 'approved') autoClassified++;
      } else if (plan.op === 'mirror') {
        await prisma.holidayRule.update({ where: { id: existing.id }, data });
        locked++;
      } else {
        await prisma.holidayRule.update({ where: { id: existing.id }, data });
        refreshed++;
        if (data.status === 'approved') autoClassified++;
      }
    }
    res.json({ ok: true, range: { startISO, endISO }, fetched: rows.length, created, refreshed, locked, autoClassified });
  }),
);

export default router;
