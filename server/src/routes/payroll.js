// Payroll module routes — the office surface (day screen + activity drawer).
// All financial math lives in payroll/engine.js (pure) + payroll/service.js
// (the ONE write path); routes stay thin, collection.js-style.
//
// Product rules enforced here:
//   • Office approval is ACTIVITY-level only (one action, all entries).
//   • No status ever blocks an office edit. An edit to a guide-approved (or
//     inquiry) entry resets guideStatus to 'pending' — the guide approves
//     again — and appends a Timeline event. Only meaningful changes create
//     history: a PATCH that changes nothing writes nothing.
//   • Calculated / override / final stay separate: cells write overrideMinor
//     (or clear it back to the calculation); calculatedMinor changes ONLY via
//     the explicit recalc action, which re-snapshots inputs.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import {
  PAYROLL_SUBJECT,
  ensureDayPayroll,
  ensureTourPayroll,
  loadComponents,
  isWeekendHoliday,
  monthOf,
} from '../payroll/service.js';
import { ENGINE_VERSION, buildEntryLines, entryTotals, autoAmountMinor } from '../payroll/engine.js';
import { vatRatePercent } from '../icountDocs.js';

const router = Router();

const ROLE_ORDER = { lead_guide: 0, guide: 1, workshop_assistant: 2 };

// Derived display status — one derivation, used by day list + drawer + portal.
export function activityDisplayStatus(activity, entries) {
  if (activity.state === 'cancelled') return 'cancelled';
  const active = (entries || []).filter((e) => e.state === 'active');
  if (active.length === 0) return 'missing';
  if (activity.status !== 'office_approved') return 'draft';
  if (active.some((e) => e.guideStatus === 'inquiry')) return 'inquiry';
  if (active.every((e) => e.guideStatus === 'approved')) return 'completed';
  return 'waiting_guide';
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const ra = a.role != null && ROLE_ORDER[a.role] != null ? ROLE_ORDER[a.role] : 9;
    const rb = b.role != null && ROLE_ORDER[b.role] != null ? ROLE_ORDER[b.role] : 9;
    if (ra !== rb) return ra - rb;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

function entryPayload(e) {
  const lines = [...(e.lines || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: e.id,
    displayName: e.displayName,
    externalPersonId: e.externalPersonId,
    role: e.role,
    state: e.state,
    guideStatus: e.guideStatus,
    guideApprovedAt: e.guideApprovedAt,
    vatStatus: e.vatStatusSnapshot,
    vatRate: e.vatRateSnapshot,
    notes: e.notes,
    lines: lines.map((l) => ({
      id: l.id,
      componentId: l.componentId,
      componentNameHe: l.componentNameHe,
      sign: l.sign,
      vatMode: l.vatMode,
      quantity: l.quantity != null ? Number(l.quantity) : null,
      unitPriceMinor: l.unitPriceMinor,
      calculatedMinor: l.calculatedMinor,
      overrideMinor: l.overrideMinor,
      note: l.note,
      sortOrder: l.sortOrder,
    })),
    totals: entryTotals(lines, { vatStatus: e.vatStatusSnapshot, vatRate: e.vatRateSnapshot }),
  };
}

function activitySummary(a) {
  const activeEntries = (a.entries || []).filter((e) => e.state === 'active');
  const officeTotalMinor = activeEntries.reduce(
    (n, e) => n + entryTotals(e.lines || [], { vatStatus: e.vatStatusSnapshot, vatRate: e.vatRateSnapshot }).totalMinor,
    0,
  );
  return {
    id: a.id,
    sourceType: a.sourceType,
    tourEventId: a.tourEventId,
    generalActivityId: a.generalActivityId,
    titleHe: a.titleHe,
    payrollMonth: a.payrollMonth,
    date: a.date,
    state: a.state,
    status: a.status,
    officeApprovedAt: a.officeApprovedAt,
    officeApprovedBy: a.officeApprovedBy,
    displayStatus: activityDisplayStatus(a, a.entries),
    entryCount: activeEntries.length,
    officeTotalMinor,
  };
}

const ACTIVITY_INCLUDE = { entries: { include: { lines: true } } };

// ---------- day screen ----------
// GET /api/payroll/day?date=YYYY-MM-DD — lazily materialises payroll for every
// completed tour of that day (idempotent; also the backfill path), then lists
// the day's payroll activities (tours + dated general activities).
router.get(
  '/day',
  handle(async (req, res) => {
    const date = String(req.query.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'invalid_date' });
    await ensureDayPayroll(prisma, date);
    const activities = await prisma.payrollActivity.findMany({
      where: { date },
      include: ACTIVITY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    // startTime for tour activities (the list sorts by tour time).
    const tourIds = activities.map((a) => a.tourEventId).filter(Boolean);
    const tourRows = tourIds.length
      ? await prisma.tourEvent.findMany({
          where: { id: { in: tourIds } },
          select: { id: true, startTime: true },
        })
      : [];
    const timeByTour = new Map(tourRows.map((t) => [t.id, t.startTime]));
    const rows = activities
      .map((a) => ({ ...activitySummary(a), startTime: a.tourEventId ? timeByTour.get(a.tourEventId) || null : null }))
      .sort((x, y) => String(x.startTime || '99').localeCompare(String(y.startTime || '99')));
    res.json({ date, activities: rows });
  }),
);

// ---------- activity drawer ----------
router.get(
  '/activities/:id',
  handle(async (req, res) => {
    let activity = await prisma.payrollActivity.findUnique({
      where: { id: req.params.id },
      include: ACTIVITY_INCLUDE,
    });
    if (!activity) return res.status(404).json({ error: 'not_found' });
    // Reconcile against current assignments on open (idempotent).
    if (activity.tourEventId && activity.state === 'active') {
      await ensureTourPayroll(prisma, activity.tourEventId);
      activity = await prisma.payrollActivity.findUnique({
        where: { id: req.params.id },
        include: ACTIVITY_INCLUDE,
      });
    }

    // Tour summary header (everything important, read-only).
    let tour = null;
    if (activity.tourEventId) {
      const t = await prisma.tourEvent.findUnique({
        where: { id: activity.tourEventId },
        include: {
          product: { select: { nameHe: true } },
          location: { select: { nameHe: true } },
          assignments: { select: { displayName: true, role: true, externalPersonId: true } },
          bookings: {
            where: { status: 'active' },
            select: {
              seats: true,
              deal: {
                select: {
                  id: true,
                  orderNo: true,
                  title: true,
                  participants: true,
                  organization: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (t) {
        tour = {
          id: t.id,
          status: t.status,
          date: t.date,
          startTime: t.startTime,
          kind: t.kind,
          tourLanguage: t.tourLanguage,
          productName: t.product?.nameHe || null,
          locationName: t.location?.nameHe || null,
          participants: t.bookings.reduce((n, b) => n + (Number(b.seats) || Number(b.deal?.participants) || 0), 0),
          customers: t.bookings.map((b) => ({
            dealId: b.deal?.id || null,
            orderNo: b.deal?.orderNo || null,
            title: b.deal?.title || null,
            organization: b.deal?.organization?.name || null,
          })),
          team: t.assignments.map((a) => ({ displayName: a.displayName, role: a.role })),
        };
      }
    }
    let general = null;
    if (activity.generalActivityId) {
      const g = await prisma.generalActivity.findUnique({
        where: { id: activity.generalActivityId },
        include: { type: { select: { nameHe: true } } },
      });
      if (g) {
        general = { id: g.id, typeName: g.type?.nameHe || null, titleHe: g.titleHe, payrollMonth: g.payrollMonth, date: g.date, notes: g.notes };
      }
    }

    const history = await prisma.timelineEntry.findMany({
      where: { subjectType: PAYROLL_SUBJECT, subjectId: activity.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });

    res.json({
      activity: activitySummary(activity),
      tour,
      general,
      entries: sortEntries(activity.entries).map(entryPayload),
      history,
    });
  }),
);

// ---------- cell edits ----------
// PATCH /api/payroll/lines/:id — override / note / (general-quantity inputs).
// Only meaningful changes persist + create history.
router.patch(
  '/lines/:id',
  handle(async (req, res) => {
    const line = await prisma.payrollEntryLine.findUnique({
      where: { id: req.params.id },
      include: { entry: { include: { activity: true } } },
    });
    if (!line) return res.status(404).json({ error: 'not_found' });
    const entry = line.entry;
    const b = req.body || {};
    const data = {};
    const changes = [];

    if ('overrideMinor' in b) {
      const next = b.overrideMinor == null ? null : Math.round(Number(b.overrideMinor));
      if (next !== null && !Number.isFinite(next)) return res.status(400).json({ error: 'invalid_amount' });
      const cur = line.overrideMinor == null ? null : Number(line.overrideMinor);
      if (cur !== next) {
        data.overrideMinor = next;
        changes.push({ field: 'override', from: cur, to: next });
      }
    }
    if ('note' in b) {
      const next = String(b.note || '').trim() || null;
      if ((line.note || null) !== next) data.note = next; // notes are quiet — no audit noise
    }
    // General-quantity inputs: editing unit price / units is an intentional
    // recalculation of that line (calculated = unit × qty), snapshot-safe
    // because the inputs live on the line itself.
    const isQtyLine = line.quantity != null || line.unitPriceMinor != null;
    if (isQtyLine && ('quantity' in b || 'unitPriceMinor' in b)) {
      const qty = 'quantity' in b ? Number(b.quantity) : Number(line.quantity);
      const unit = 'unitPriceMinor' in b ? Math.round(Number(b.unitPriceMinor)) : Number(line.unitPriceMinor);
      if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(unit)) {
        return res.status(400).json({ error: 'invalid_quantity_or_price' });
      }
      const nextCalc = Math.round(unit * qty);
      if (Number(line.quantity) !== qty || Number(line.unitPriceMinor) !== unit) {
        data.quantity = qty;
        data.unitPriceMinor = unit;
        data.calculatedMinor = nextCalc;
        changes.push({ field: 'quantity_price', from: { quantity: Number(line.quantity), unitPriceMinor: Number(line.unitPriceMinor) }, to: { quantity: qty, unitPriceMinor: unit } });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.json({ ok: true, unchanged: true });
    }
    const updated = await prisma.payrollEntryLine.update({ where: { id: line.id }, data });

    const origin = await userOrigin(req.adminAuth?.userId);
    if (changes.length) {
      const fmt = (m) => (m == null ? '—' : `₪${(Number(m) / 100).toLocaleString('he-IL')}`);
      const c = changes[0];
      const body =
        c.field === 'override'
          ? `✏️ ${entry.displayName} · ${line.componentNameHe}: ${fmt(c.from ?? line.calculatedMinor)} → ${fmt(c.to ?? line.calculatedMinor)}`
          : `✏️ ${entry.displayName} · ${line.componentNameHe}: עודכנו כמות/מחיר`;
      await emitTimelineEvent(prisma, {
        subjectType: PAYROLL_SUBJECT,
        subjectId: entry.activityId,
        kind: 'payroll',
        body,
        data: { event: 'line_changed', entryId: entry.id, lineId: line.id, component: line.componentNameHe, changes },
        origin,
      });
      // Office edit after guide approval/inquiry → the guide must approve again.
      if (entry.guideStatus === 'approved' || entry.guideStatus === 'inquiry') {
        await prisma.payrollEntry.update({
          where: { id: entry.id },
          data: { guideStatus: 'pending', guideApprovedAt: null },
        });
        await emitTimelineEvent(prisma, {
          subjectType: PAYROLL_SUBJECT,
          subjectId: entry.activityId,
          kind: 'payroll',
          body: `🔁 נדרש אישור מחדש של ${entry.displayName} (הרשומה עודכנה)`,
          data: { event: 'guide_reapproval_required', entryId: entry.id },
          origin,
        });
      }
    }
    res.json({ ok: true, line: { id: updated.id, overrideMinor: updated.overrideMinor, calculatedMinor: updated.calculatedMinor, quantity: updated.quantity != null ? Number(updated.quantity) : null, unitPriceMinor: updated.unitPriceMinor, note: updated.note } });
  }),
);

// ---------- office approval (activity-level, ONE action) ----------
router.post(
  '/activities/:id/approve',
  handle(async (req, res) => {
    const activity = await prisma.payrollActivity.findUnique({
      where: { id: req.params.id },
      include: { entries: true },
    });
    if (!activity) return res.status(404).json({ error: 'not_found' });
    if (activity.state !== 'active') return res.status(409).json({ error: 'activity_cancelled' });
    if (activity.status === 'office_approved') return res.json({ ok: true, already: true });
    const origin = await userOrigin(req.adminAuth?.userId);
    const updated = await prisma.payrollActivity.update({
      where: { id: activity.id },
      data: {
        status: 'office_approved',
        officeApprovedAt: new Date(),
        officeApprovedBy: origin.createdByName || null,
      },
      include: ACTIVITY_INCLUDE,
    });
    await emitTimelineEvent(prisma, {
      subjectType: PAYROLL_SUBJECT,
      subjectId: activity.id,
      kind: 'payroll',
      body: '✅ פעילות השכר אושרה על ידי המשרד',
      data: { event: 'office_approved' },
      origin,
    });
    res.json({ ok: true, activity: activitySummary(updated) });
  }),
);

router.post(
  '/activities/:id/unapprove',
  handle(async (req, res) => {
    const activity = await prisma.payrollActivity.findUnique({ where: { id: req.params.id }, include: ACTIVITY_INCLUDE });
    if (!activity) return res.status(404).json({ error: 'not_found' });
    if (activity.status !== 'office_approved') return res.json({ ok: true, already: true });
    const origin = await userOrigin(req.adminAuth?.userId);
    const updated = await prisma.payrollActivity.update({
      where: { id: activity.id },
      data: { status: 'draft', officeApprovedAt: null, officeApprovedBy: null },
      include: ACTIVITY_INCLUDE,
    });
    await emitTimelineEvent(prisma, {
      subjectType: PAYROLL_SUBJECT,
      subjectId: activity.id,
      kind: 'payroll',
      body: '↩️ אישור המשרד הוסר — הפעילות חזרה לטיוטה',
      data: { event: 'office_unapproved' },
      origin,
    });
    res.json({ ok: true, activity: activitySummary(updated) });
  }),
);

// ---------- explicit recalculation ----------
// POST /api/payroll/entries/:id/recalc — re-runs the engine with CURRENT
// rates/rules, writes a NEW calc snapshot, updates calculatedMinor per line
// (overrides untouched), and adds catalog components that didn't exist when
// the entry was created. This is the ONLY path that changes calculations.
router.post(
  '/entries/:id/recalc',
  handle(async (req, res) => {
    const entry = await prisma.payrollEntry.findUnique({
      where: { id: req.params.id },
      include: { lines: true, activity: true },
    });
    if (!entry) return res.status(404).json({ error: 'not_found' });
    const activity = entry.activity;

    const person = await prisma.personRef.findUnique({
      where: { externalPersonId: entry.externalPersonId },
      include: { profile: true },
    });
    let inputs;
    let source;
    if (activity.sourceType === 'tour_event' && activity.tourEventId) {
      const tour = await prisma.tourEvent.findUnique({
        where: { id: activity.tourEventId },
        include: {
          productVariant: { select: { baseGuidePaymentMinor: true, travelPaymentMinor: true } },
          bookings: { select: { status: true, seats: true, deal: { select: { participants: true } } } },
        },
      });
      if (!tour) return res.status(409).json({ error: 'tour_missing' });
      const activeBookings = tour.bookings.filter((b) => b.status === 'active');
      const seats = activeBookings.reduce((n, b) => n + (Number(b.seats) || 0), 0);
      source = 'tour';
      inputs = {
        role: entry.role,
        baseGuidePaymentMinor: tour.productVariant?.baseGuidePaymentMinor ?? null,
        variantTravelMinor: tour.productVariant?.travelPaymentMinor ?? null,
        participants: seats > 0 ? seats : activeBookings.reduce((n, b) => n + (Number(b.deal?.participants) || 0), 0),
        isWeekendHoliday: await isWeekendHoliday(prisma, tour.date, tour.startTime),
        seniorityIls: person?.profile?.senioritySupplement ?? null,
        travelAllowanceIls: person?.profile?.travelAllowance ?? null,
      };
    } else {
      // General entries: the quantity line's own unit/qty are the inputs.
      const qtyLine = entry.lines.find((l) => l.quantity != null || l.unitPriceMinor != null);
      source = 'general';
      inputs = {
        unitPriceMinor: qtyLine ? Number(qtyLine.unitPriceMinor) : 0,
        quantity: qtyLine ? Number(qtyLine.quantity) : 1,
        seniorityIls: person?.profile?.senioritySupplement ?? null,
        travelAllowanceIls: person?.profile?.travelAllowance ?? null,
      };
    }

    const components = await loadComponents(prisma);
    const freshLines = buildEntryLines({ source, components, inputs });
    const byComponent = new Map(entry.lines.map((l) => [l.componentId, l]));
    const changes = [];
    for (const fresh of freshLines) {
      const existing = byComponent.get(fresh.componentId);
      if (!existing) {
        await prisma.payrollEntryLine.create({
          data: {
            entryId: entry.id,
            componentId: fresh.componentId,
            componentNameHe: fresh.componentNameHe,
            sign: fresh.sign,
            vatMode: fresh.vatMode,
            quantity: fresh.quantity,
            unitPriceMinor: fresh.unitPriceMinor,
            calculatedMinor: fresh.calculatedMinor,
            sortOrder: fresh.sortOrder,
          },
        });
        changes.push({ component: fresh.componentNameHe, from: null, to: fresh.calculatedMinor, added: true });
        continue;
      }
      const cur = existing.calculatedMinor == null ? null : Number(existing.calculatedMinor);
      const next = fresh.calculatedMinor == null ? null : Number(fresh.calculatedMinor);
      if (cur !== next) {
        await prisma.payrollEntryLine.update({
          where: { id: existing.id },
          data: { calculatedMinor: next },
        });
        changes.push({ component: existing.componentNameHe, from: cur, to: next });
      }
    }

    const vatStatus = person?.profile?.vatStatus === 'vat_18' ? 'vat_18' : entry.vatStatusSnapshot;
    await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: {
        vatStatusSnapshot: vatStatus,
        vatRateSnapshot: vatRatePercent(),
        engineVersion: ENGINE_VERSION,
        calcSnapshot: {
          engineVersion: ENGINE_VERSION,
          at: new Date().toISOString(),
          source,
          inputs: JSON.parse(JSON.stringify(inputs, (k, v) => (typeof v === 'bigint' ? Number(v) : v))),
        },
      },
    });

    const origin = await userOrigin(req.adminAuth?.userId);
    if (changes.length) {
      await emitTimelineEvent(prisma, {
        subjectType: PAYROLL_SUBJECT,
        subjectId: activity.id,
        kind: 'payroll',
        body: `🔄 חושב מחדש עבור ${entry.displayName} (${changes.length} רכיבים עודכנו)`,
        data: { event: 'recalculated', entryId: entry.id, changes },
        origin,
      });
      if (entry.guideStatus === 'approved' || entry.guideStatus === 'inquiry') {
        await prisma.payrollEntry.update({
          where: { id: entry.id },
          data: { guideStatus: 'pending', guideApprovedAt: null },
        });
      }
    }
    const fresh = await prisma.payrollEntry.findUnique({ where: { id: entry.id }, include: { lines: true } });
    res.json({ ok: true, changed: changes.length, entry: entryPayload(fresh) });
  }),
);

export default router;
