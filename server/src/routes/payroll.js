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
//     (or clear it back to the calculation). calculatedMinor changes
//     automatically ONLY while the activity is DRAFT (ensureTourPayroll's
//     auto-sync); after office approval nothing recalculates automatically —
//     the sole exception is the month-gated admin MAINTENANCE recalc below,
//     which normal UI never exposes.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import {
  PAYROLL_SUBJECT,
  ensureDayPayroll,
  ensureTourPayroll,
  createGeneralActivity,
  recalcEntry,
  approveEntries,
  unapproveEntry,
  kickPayrollReconcile,
  monthOf,
} from '../payroll/service.js';
import { entryTotals, deriveOfficeState } from '../payroll/engine.js';
import { businessToday } from '../tours/completion.js';

const router = Router();

const ROLE_ORDER = { lead_guide: 0, guide: 1, workshop_assistant: 2 };

// Derived display status — one derivation, used by day list + drawer + report.
// Office approval truth is PER ENTRY; the activity state is derived
// (deriveOfficeState) and never persisted.
export function activityDisplayStatus(activity, entries) {
  if (activity.state !== 'active') return 'cancelled';
  const active = (entries || []).filter((e) => e.state === 'active');
  if (active.length === 0) return 'missing';
  if (active.some((e) => e.officeStatus === 'approved' && e.guideStatus === 'inquiry')) return 'inquiry';
  const officeState = deriveOfficeState(active);
  if (officeState === 'draft') return 'draft';
  if (officeState === 'partially_approved') return 'partially_approved';
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
    officeStatus: e.officeStatus,
    officeApprovedAt: e.officeApprovedAt,
    officeApprovedBy: e.officeApprovedBy,
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
  const approvedEntries = activeEntries.filter((e) => e.officeStatus === 'approved');
  return {
    id: a.id,
    sourceType: a.sourceType,
    tourEventId: a.tourEventId,
    generalActivityId: a.generalActivityId,
    titleHe: a.titleHe,
    payrollMonth: a.payrollMonth,
    date: a.date,
    state: a.state,
    // DERIVED from the entries — the activity has no persisted approval.
    status: deriveOfficeState(activeEntries),
    approvedCount: approvedEntries.length,
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
    // Month-level general activities (no specific day) belong to the month —
    // shown in their own section of the day screen.
    const monthActivities = await prisma.payrollActivity.findMany({
      where: { payrollMonth: monthOf(date), date: null },
      include: ACTIVITY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      date,
      activities: rows,
      monthActivities: monthActivities.map((a) => ({ ...activitySummary(a), startTime: null })),
    });
  }),
);

// ---------- report (grouped by guide) ----------
// GET /api/payroll/report?months=YYYY-MM,YYYY-MM,…
// The client composes the month set from the year/month multi-select — one
// year, several years, whole years, cross-year comparisons: all just a list.
// Admin totals include office-approved entries IMMEDIATELY (guide approval is
// not required); guide-approved and waiting are broken out alongside.
router.get(
  '/report',
  handle(async (req, res) => {
    const months = String(req.query.months || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}$/.test(s));
    if (months.length === 0) return res.status(400).json({ error: 'months_required' });
    const guideFilter = String(req.query.guides || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const allEntries = await prisma.payrollEntry.findMany({
      where: { state: 'active', activity: { state: 'active', payrollMonth: { in: months } } },
      include: { activity: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });
    // Guide options come from the UNfiltered month set (so the dropdown keeps
    // showing everyone in range); totals/rows below honor the filter — the
    // summary numbers stay server-owned under any selection.
    const guideOptions = [
      ...new Map(allEntries.map((e) => [e.externalPersonId, e.displayName])).entries(),
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'he'));
    const entries = guideFilter.length
      ? allEntries.filter((e) => guideFilter.includes(e.externalPersonId))
      : allEntries;

    const zero = () => ({
      officeApprovedMinor: 0,
      guideApprovedMinor: 0,
      waitingMinor: 0,
      draftMinor: 0,
      // Inquiry stays INSIDE the office-approved commitment, broken out for
      // visibility (product rule).
      inquiryMinor: 0,
    });
    const summary = zero();
    const byGuide = new Map();
    for (const e of entries) {
      const totals = entryTotals(e.lines, { vatStatus: e.vatStatusSnapshot, vatRate: e.vatRateSnapshot });
      // Entry-level office approval — THE truth (activity state is derived).
      const officeApproved = e.officeStatus === 'approved';
      const status = !officeApproved
        ? 'draft'
        : e.guideStatus === 'approved'
          ? 'completed'
          : e.guideStatus === 'inquiry'
            ? 'inquiry'
            : 'waiting_guide';

      let g = byGuide.get(e.externalPersonId);
      if (!g) {
        g = { externalPersonId: e.externalPersonId, displayName: e.displayName, entries: [], totals: zero() };
        byGuide.set(e.externalPersonId, g);
      }
      g.displayName = e.displayName; // latest snapshot wins for the header
      for (const t of [g.totals, summary]) {
        if (officeApproved) {
          t.officeApprovedMinor += totals.totalMinor;
          if (e.guideStatus === 'approved') t.guideApprovedMinor += totals.totalMinor;
          else t.waitingMinor += totals.totalMinor;
          if (e.guideStatus === 'inquiry') t.inquiryMinor += totals.totalMinor;
        } else {
          t.draftMinor += totals.totalMinor;
        }
      }
      g.entries.push({
        id: e.id,
        activityId: e.activityId,
        activityTitle: e.activity.titleHe,
        sourceType: e.activity.sourceType,
        date: e.activity.date,
        payrollMonth: e.activity.payrollMonth,
        role: e.role,
        status,
        guideStatus: e.guideStatus,
        vatStatus: e.vatStatusSnapshot,
        hasOverride: e.lines.some((l) => l.overrideMinor != null),
        notes: e.notes,
        officeApprovedBy: e.officeApprovedBy,
        lines: e.lines
          .filter((l) => (l.overrideMinor ?? l.calculatedMinor) != null && Number(l.overrideMinor ?? l.calculatedMinor) !== 0)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((l) => ({
            name: l.componentNameHe,
            sign: l.sign,
            amountMinor: Number(l.overrideMinor ?? l.calculatedMinor),
            overridden: l.overrideMinor != null,
          })),
        totals,
      });
    }
    const guides = [...byGuide.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));
    for (const g of guides) {
      g.entries.sort((a, b) => String(a.date || a.payrollMonth).localeCompare(String(b.date || b.payrollMonth)));
    }
    res.json({ months, guides, guideOptions, summary });
  }),
);

// ---------- general activities ----------
// Staff picking reuses the canonical /api/people/assignable endpoint (the
// SAME eligibility rule Tour assignment uses) — no payroll-local staff list.
router.post(
  '/general-activities',
  handle(async (req, res) => {
    const b = req.body || {};
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await createGeneralActivity(prisma, {
      typeId: String(b.typeId || ''),
      payrollMonth: String(b.payrollMonth || ''),
      date: b.date || null,
      notes: b.notes ? String(b.notes) : null,
      rows: Array.isArray(b.rows) ? b.rows : [],
      origin,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, activityId: result.activityId });
  }),
);

// ---------- catalogs (settings) ----------
// Component catalog — nothing is hardcoded. System rows keep their identity
// (key/kind/autoRule/isSystem immutable); everything display/behavioral is
// editable, including auto-rule config (weekend amount, participant bonus).
const COMPONENT_EDITABLE = ['nameHe', 'sign', 'vatMode', 'scope', 'officeAlways', 'guideVisible', 'active', 'config'];
const VAT_MODES = ['net', 'gross', 'none'];
const SCOPES = ['all', 'tour', 'general'];

router.get(
  '/components',
  handle(async (req, res) => {
    const components = await prisma.payrollComponent.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ components });
  }),
);

router.post(
  '/components',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    const max = await prisma.payrollComponent.aggregate({ _max: { sortOrder: true } });
    const component = await prisma.payrollComponent.create({
      data: {
        nameHe,
        kind: 'manual',
        sign: Number(b.sign) === -1 ? -1 : 1,
        vatMode: VAT_MODES.includes(b.vatMode) ? b.vatMode : 'net',
        scope: SCOPES.includes(b.scope) ? b.scope : 'all',
        officeAlways: b.officeAlways !== false,
        guideVisible: b.guideVisible !== false,
        sortOrder: (max._max.sortOrder || 0) + 10,
      },
    });
    // Existing DRAFT entries gain the new component row in the background.
    kickPayrollReconcile('all');
    res.json({ component });
  }),
);

router.patch(
  '/components/:id',
  handle(async (req, res) => {
    const existing = await prisma.payrollComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const data = {};
    for (const k of COMPONENT_EDITABLE) {
      if (!(k in b)) continue;
      if (k === 'nameHe') {
        const v = String(b.nameHe || '').trim();
        if (!v) return res.status(400).json({ error: 'name_required' });
        data.nameHe = v;
      } else if (k === 'sign') data.sign = Number(b.sign) === -1 ? -1 : 1;
      else if (k === 'vatMode') {
        if (!VAT_MODES.includes(b.vatMode)) return res.status(400).json({ error: 'invalid_vat_mode' });
        data.vatMode = b.vatMode;
      } else if (k === 'scope') {
        if (!SCOPES.includes(b.scope)) return res.status(400).json({ error: 'invalid_scope' });
        data.scope = b.scope;
      } else if (k === 'config') {
        data.config = b.config && typeof b.config === 'object' ? b.config : undefined;
      } else data[k] = !!b[k];
    }
    const component = await prisma.payrollComponent.update({ where: { id: existing.id }, data });
    // Rule config / activation changes flow into DRAFT calculations only.
    kickPayrollReconcile('all');
    res.json({ component });
  }),
);

router.delete(
  '/components/:id',
  handle(async (req, res) => {
    const existing = await prisma.payrollComponent.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { lines: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.isSystem) return res.status(409).json({ error: 'system_component' });
    if (existing._count.lines > 0) return res.status(409).json({ error: 'component_in_use' });
    await prisma.payrollComponent.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

router.put(
  '/components/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    await Promise.all(
      ids.map((id, i) =>
        prisma.payrollComponent.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } }).catch(() => null),
      ),
    );
    res.json({ ok: true });
  }),
);

// General activity types catalog.
router.get(
  '/activity-types',
  handle(async (req, res) => {
    const types = await prisma.generalActivityType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ types });
  }),
);

router.post(
  '/activity-types',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    const max = await prisma.generalActivityType.aggregate({ _max: { sortOrder: true } });
    const type = await prisma.generalActivityType.create({
      data: {
        nameHe,
        defaultUnitPriceMinor: Math.round(Number(b.defaultUnitPriceMinor) || 0),
        defaultQuantity: Number.isFinite(Number(b.defaultQuantity)) && Number(b.defaultQuantity) >= 0 ? Number(b.defaultQuantity) : 1,
        defaultNotes: b.defaultNotes ? String(b.defaultNotes) : null,
        sortOrder: (max._max.sortOrder || 0) + 10,
      },
    });
    res.json({ type });
  }),
);

router.patch(
  '/activity-types/:id',
  handle(async (req, res) => {
    const existing = await prisma.generalActivityType.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const data = {};
    if ('nameHe' in b) {
      const v = String(b.nameHe || '').trim();
      if (!v) return res.status(400).json({ error: 'name_required' });
      data.nameHe = v;
    }
    if ('defaultUnitPriceMinor' in b) data.defaultUnitPriceMinor = Math.round(Number(b.defaultUnitPriceMinor) || 0);
    if ('defaultQuantity' in b) {
      const q = Number(b.defaultQuantity);
      if (!Number.isFinite(q) || q < 0) return res.status(400).json({ error: 'invalid_quantity' });
      data.defaultQuantity = q;
    }
    if ('defaultNotes' in b) data.defaultNotes = b.defaultNotes ? String(b.defaultNotes) : null;
    if ('active' in b) data.active = !!b.active;
    const type = await prisma.generalActivityType.update({ where: { id: existing.id }, data });
    res.json({ type });
  }),
);

router.delete(
  '/activity-types/:id',
  handle(async (req, res) => {
    const existing = await prisma.generalActivityType.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { activities: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing._count.activities > 0) return res.status(409).json({ error: 'type_in_use' });
    await prisma.generalActivityType.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

router.put(
  '/activity-types/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    await Promise.all(
      ids.map((id, i) =>
        prisma.generalActivityType.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } }).catch(() => null),
      ),
    );
    res.json({ ok: true });
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

// ---------- office approval (entry-level truth, ONE service) ----------
// POST /activities/:id/approve — the bulk "אשר שכר" action: approve every
// currently-unapproved VALID entry (optionally restricted to body.entryIds).
// Entries with nothing to pay are skipped and reported, never silently
// approved. The per-person control uses the SAME service via the entry
// endpoints below — no second approval source.
router.post(
  '/activities/:id/approve',
  handle(async (req, res) => {
    const origin = await userOrigin(req.adminAuth?.userId);
    const entryIds = Array.isArray(req.body?.entryIds) ? req.body.entryIds : null;
    const result = await approveEntries(prisma, { activityId: req.params.id, entryIds, origin });
    if (result.error) {
      return res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error });
    }
    const fresh = await prisma.payrollActivity.findUnique({ where: { id: req.params.id }, include: ACTIVITY_INCLUDE });
    res.json({ ok: true, approved: result.approved, skipped: result.skipped, activity: activitySummary(fresh) });
  }),
);

router.post(
  '/entries/:id/office-approve',
  handle(async (req, res) => {
    const entry = await prisma.payrollEntry.findUnique({ where: { id: req.params.id }, select: { activityId: true } });
    if (!entry) return res.status(404).json({ error: 'not_found' });
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await approveEntries(prisma, {
      activityId: entry.activityId,
      entryIds: [req.params.id],
      origin,
    });
    if (result.error) return res.status(409).json({ error: result.error });
    if (result.skipped.length) return res.status(422).json({ error: 'zero_total', skipped: result.skipped });
    res.json({ ok: true });
  }),
);

router.post(
  '/entries/:id/office-unapprove',
  handle(async (req, res) => {
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await unapproveEntry(prisma, { entryId: req.params.id, origin });
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ ok: true, already: result.already === true });
  }),
);

// ---------- admin MAINTENANCE recalculation ----------
// POST /api/payroll/entries/:id/maintenance-recalc — a true recalculation
// from CURRENT business rules (e.g. after fixing the payroll engine). NOT a
// normal operation and never exposed as a UI button: drafts already
// auto-sync, approved activities change only by manual edit. Gated to the
// CURRENT and IMMEDIATELY PREVIOUS payroll month (business TZ) — older
// payroll never recalculates. Overrides preserved; guide re-approval
// enforced on change.
router.post(
  '/entries/:id/maintenance-recalc',
  handle(async (req, res) => {
    const entry = await prisma.payrollEntry.findUnique({
      where: { id: req.params.id },
      include: { activity: true },
    });
    if (!entry) return res.status(404).json({ error: 'not_found' });

    const currentMonth = businessToday().slice(0, 7);
    const [y, m] = currentMonth.split('-').map(Number);
    const previousMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    if (![currentMonth, previousMonth].includes(entry.activity.payrollMonth)) {
      return res.status(409).json({ error: 'month_locked_for_recalc' });
    }

    const result = await recalcEntry(prisma, entry.id);
    if (result.error) return res.status(409).json({ error: result.error });
    const changes = result.changes;

    const origin = await userOrigin(req.adminAuth?.userId);
    if (changes.length) {
      await emitTimelineEvent(prisma, {
        subjectType: PAYROLL_SUBJECT,
        subjectId: entry.activityId,
        kind: 'payroll',
        body: `🛠️ חישוב תחזוקה מחדש עבור ${entry.displayName} (${changes.length} רכיבים עודכנו)`,
        data: { event: 'maintenance_recalculated', entryId: entry.id, changes },
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
