// Payroll service — the ONE write path for payroll rows (routes stay thin).
// Generation is IDEMPOTENT and additive:
//   • ensureTourPayroll materialises the PayrollActivity + one entry per
//     assignment for a COMPLETED tour, and reconciles later assignment
//     changes (new assignment → new entry; removed → entry state 'cancelled';
//     re-added → reactivated). Existing entries are never auto-recalculated —
//     snapshots isolate old payroll from future rate/rule changes.
//   • Nothing is ever deleted. Reopen/cancel flips state to 'cancelled' and
//     appends a Timeline event (subjectType 'payroll_activity').
//
// `client` may be the root prisma or a transaction, same as tours/completion.

import { prisma } from '../db.js';
import { isAssignableStaff } from '../people/eligibility.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { sabbathHolidayWindow } from '../pricing/engine.js';
import { vatRatePercent } from '../icountDocs.js';
import {
  ENGINE_VERSION,
  WEEKEND_MULTIPLIER,
  buildEntryLines,
  deriveOfficeState,
  entryApprovable,
} from './engine.js';
import { emitPayrollChanged } from './events.js';

export const PAYROLL_SUBJECT = 'payroll_activity';

export function monthOf(dateISO) {
  return typeof dateISO === 'string' && /^\d{4}-\d{2}/.test(dateISO)
    ? dateISO.slice(0, 7)
    : null;
}

export async function loadComponents(client = prisma) {
  return client.payrollComponent.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

// שבת/חג decision for a tour date+time — fed by the ONE detector
// (pricing/engine.js sabbathHolidayWindow) and the global CRM-settings rules,
// exactly like pricingCalc. Never re-implemented. Returns the FULL window
// result so the calc snapshot can record which rule/window matched.
export async function sabbathHolidayInfo(client, dateISO, startTime) {
  if (!dateISO) return { applies: false, matched: [] };
  const dt = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return { applies: false, matched: [] };
  const weekday = dt.getUTCDay();
  let minuteOfDay = 0;
  if (startTime) {
    const [hh, mm] = String(startTime).split(':').map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) minuteOfDay = hh * 60 + mm;
  }
  const [weekly, holidays] = await Promise.all([
    client.sabbathWeeklyRule.findMany({ where: { active: true } }),
    client.holidayRule.findMany({ where: { active: true, status: 'approved' } }),
  ]);
  return sabbathHolidayWindow({ weekday, minuteOfDay, dateISO }, { weekly, holidays });
}

// The engine inputs for a tour's entries, incl. the calc-snapshot context the
// weekend rule requires: the base used, the multiplier, and WHICH שבת/חג
// window matched (rule identity) — so every stored calculation is
// reproducible forever without today's settings.
async function buildTourInputs(client, tour, components) {
  const sabbath = await sabbathHolidayInfo(client, tour.date, tour.startTime);
  const weekendComponent = (components || []).find(
    (c) => c.autoRule === 'weekend_holiday_percent_of_base' || c.autoRule === 'weekend_holiday',
  );
  return {
    baseGuidePaymentMinor: tour.productVariant?.baseGuidePaymentMinor ?? null,
    variantTravelMinor: tour.productVariant?.travelPaymentMinor ?? null,
    participants: participantsTotal(tour.bookings),
    isWeekendHoliday: sabbath.applies === true,
    sabbathHoliday: {
      applies: sabbath.applies === true,
      type: sabbath.type || null,
      label: sabbath.label || null,
    },
    weekendMultiplier: Number(weekendComponent?.config?.multiplier) || WEEKEND_MULTIPLIER,
  };
}

function tourTitle(tour) {
  const product = tour.product?.nameHe || null;
  const location = tour.location?.nameHe || null;
  if (product && location) return `${product} · ${location}`;
  return product || location || 'סיור';
}

function participantsTotal(bookings) {
  const active = (bookings || []).filter((b) => b.status === 'active');
  const seats = active.reduce((n, b) => n + (Number(b.seats) || 0), 0);
  if (seats > 0) return seats;
  return active.reduce((n, b) => n + (Number(b.deal?.participants) || 0), 0);
}

// Internal lifecycle/reconcile timeline events → real-time invalidation
// reasons. Only meaningful changes reach emitPayrollEvent (the callers guard
// on actual change), so piggybacking the realtime hint here keeps the
// "no-op emits nothing" rule for free.
const REALTIME_REASON = {
  created: 'activity_created',
  reactivated: 'entry_updated',
  entry_reactivated: 'entry_updated',
  entry_cancelled: 'entry_updated',
  draft_auto_recalculated: 'entry_updated',
  cancelled: 'activity_cancelled',
};

async function emitPayrollEvent(client, activityId, body, data, origin = null) {
  await emitTimelineEvent(client, {
    subjectType: PAYROLL_SUBJECT,
    subjectId: activityId,
    kind: 'payroll',
    body,
    data,
    origin: origin || systemOrigin(),
  });
  const reason = REALTIME_REASON[data?.event];
  if (reason) {
    emitPayrollChanged(client, {
      activityId,
      externalPersonId: data?.externalPersonId || null,
      reason,
    });
  }
}

function snapshotOf(source, inputs) {
  return {
    engineVersion: ENGINE_VERSION,
    at: new Date().toISOString(),
    source,
    inputs: JSON.parse(JSON.stringify(inputs, (k, v) => (typeof v === 'bigint' ? Number(v) : v))),
  };
}

// Create one entry (+ engine lines) for a person on an activity.
async function createEntry(client, { activity, source, person, role, tourAssignmentId, components, inputs }) {
  const vatStatus = person.profile?.vatStatus === 'vat_18' ? 'vat_18' : 'exempt';
  const vatRate = vatRatePercent();
  const fullInputs = {
    ...inputs,
    role,
    seniorityIls: person.profile?.senioritySupplement ?? null,
    travelAllowanceIls: person.profile?.travelAllowance ?? null,
  };
  const lines = buildEntryLines({ source, components, inputs: fullInputs });
  return client.payrollEntry.create({
    data: {
      activityId: activity.id,
      personRefId: person.personRefId || null,
      externalPersonId: person.externalPersonId,
      displayName: person.displayName,
      role: role || null,
      tourAssignmentId: tourAssignmentId || null,
      vatStatusSnapshot: vatStatus,
      vatRateSnapshot: vatRate,
      engineVersion: ENGINE_VERSION,
      calcSnapshot: snapshotOf(source, fullInputs),
      lines: {
        create: lines.map((l) => ({
          componentId: l.componentId,
          componentNameHe: l.componentNameHe,
          sign: l.sign,
          vatMode: l.vatMode,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          calculatedMinor: l.calculatedMinor,
          sortOrder: l.sortOrder,
        })),
      },
    },
    include: { lines: true },
  });
}

// Materialise/reconcile payroll for a COMPLETED tour. Idempotent — safe to
// call from the completion hook, the day screen, and the drawer.
// Decide how a tour's payroll entries reconcile against its current
// assignments. Matching is by the ASSIGNMENT SLOT (tourAssignmentId), NOT the
// person — a payroll-only guide change (change-guide) repoints an entry's owner
// away from the assignment's person while keeping the slot, and must survive
// this reconcile (which runs on every activity open). Legacy entries with no
// slot fall back to their person. Pure + deterministic so it can be tested
// without a database.
//   returns { create: [assignment], reactivate: [{entry, assignment}], cancel: [entry] }
export function planSlotReconcile(assignments, entries) {
  const entryBySlot = new Map();
  const entryByExt = new Map();
  for (const e of entries) {
    if (e.tourAssignmentId) entryBySlot.set(e.tourAssignmentId, e);
    else entryByExt.set(e.externalPersonId, e);
  }
  const create = [];
  const reactivate = [];
  for (const a of assignments) {
    const existing = entryBySlot.get(a.id) || entryByExt.get(a.externalPersonId);
    if (!existing) create.push(a);
    else if (existing.state === 'cancelled') reactivate.push({ entry: existing, assignment: a });
  }
  const assignedSlots = new Set(assignments.map((a) => a.id));
  const cancel = entries.filter(
    (e) => e.state === 'active' && e.tourAssignmentId && !assignedSlots.has(e.tourAssignmentId),
  );
  return { create, reactivate, cancel };
}

export async function ensureTourPayroll(client, tourEventId) {
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    include: {
      product: { select: { nameHe: true } },
      productVariant: { select: { baseGuidePaymentMinor: true, travelPaymentMinor: true } },
      location: { select: { nameHe: true } },
      assignments: true,
      bookings: { select: { status: true, seats: true, deal: { select: { participants: true } } } },
      payrollActivity: { include: { entries: true } },
    },
  });
  if (!tour || tour.status !== 'completed' || !tour.date) return null;
  // Migration-owned tours (runbook v2): their payroll is FROZEN historical
  // evidence written by the importer — never reconciled, never regenerated.
  // completedReason='migration' is set only by the importer, atomically with
  // the LegacyRecord crosswalk row, so it is the migration-ownership marker.
  if (tour.completedReason === 'migration') return tour.payrollActivity ?? null;

  let activity = tour.payrollActivity;
  // A VOIDED activity is a deliberate human decision — reconciliation never
  // resurrects it (unlike 'cancelled', which reopen/re-complete reactivates).
  if (activity && activity.state === 'voided') return activity;
  if (!activity) {
    activity = await client.payrollActivity.create({
      data: {
        sourceType: 'tour_event',
        tourEventId: tour.id,
        titleHe: tourTitle(tour),
        payrollMonth: monthOf(tour.date),
        date: tour.date,
      },
      include: { entries: true },
    });
    await emitPayrollEvent(client, activity.id, '🧾 נוצרה פעילות שכר עבור הסיור', {
      event: 'created',
      sourceType: 'tour_event',
      tourEventId: tour.id,
    });
  } else if (activity.state === 'cancelled') {
    // Tour was reopened and completed again — reactivate, never recreate.
    activity = await client.payrollActivity.update({
      where: { id: activity.id },
      data: { state: 'active', date: tour.date, payrollMonth: monthOf(tour.date) },
      include: { entries: true },
    });
    await client.payrollEntry.updateMany({
      where: { activityId: activity.id, state: 'cancelled', tourAssignmentId: { not: null } },
      data: { state: 'active' },
    });
    await emitPayrollEvent(client, activity.id, '↩️ פעילות השכר הוחזרה לפעילה (הסיור הושלם מחדש)', {
      event: 'reactivated',
    });
    activity = await client.payrollActivity.findUnique({
      where: { id: activity.id },
      include: { entries: true },
    });
  }

  // Reconcile entries against current assignments by the ASSIGNMENT SLOT
  // (tourAssignmentId) — NOT the person. A payroll-only guide change
  // (change-guide) deliberately repoints an entry's owner away from the
  // assignment's person while KEEPING the slot; matching by person here would
  // recreate the old guide's entry and cancel the reassigned one on the next
  // reconcile (this runs on every activity open). The slot is the stable key.
  const components = await loadComponents(client);
  // Profiles for BOTH the assigned people AND current entry owners: a
  // reassigned entry's owner is not among the assignments, but their
  // seniority / travel / VAT must still drive the draft recalculation below.
  const extIds = new Set([
    ...tour.assignments.map((a) => a.externalPersonId),
    ...activity.entries.filter((e) => e.state === 'active').map((e) => e.externalPersonId),
  ]);
  const persons = extIds.size
    ? await client.personRef.findMany({
        where: { externalPersonId: { in: [...extIds] } },
        include: { profile: true },
      })
    : [];
  const personByExt = new Map(persons.map((p) => [p.externalPersonId, p]));
  const tourInputs = await buildTourInputs(client, tour, components);

  // Slot-based reconcile (see planSlotReconcile) — reassigned entries keep their
  // slot and survive; only genuinely unfilled slots create entries and only
  // slots that lost their assignment cancel.
  const plan = planSlotReconcile(tour.assignments, activity.entries);
  let changed = false;
  for (const { entry: existing, assignment: a } of plan.reactivate) {
    await client.payrollEntry.update({
      where: { id: existing.id },
      data: { state: 'active', tourAssignmentId: a.id, role: a.role },
    });
    await emitPayrollEvent(client, activity.id, `↩️ הרשומה של ${existing.displayName} הוחזרה לפעילה (שובץ מחדש)`, {
      event: 'entry_reactivated',
      externalPersonId: existing.externalPersonId,
    });
    changed = true;
  }
  for (const a of plan.create) {
    const person = personByExt.get(a.externalPersonId);
    await createEntry(client, {
      activity,
      source: 'tour',
      person: {
        personRefId: person?.id || a.personRefId || null,
        externalPersonId: a.externalPersonId,
        displayName: a.displayName,
        profile: person?.profile || null,
      },
      role: a.role,
      tourAssignmentId: a.id,
      components,
      inputs: tourInputs,
    });
    changed = true;
  }
  for (const e of plan.cancel) {
    await client.payrollEntry.update({ where: { id: e.id }, data: { state: 'cancelled' } });
    await emitPayrollEvent(client, activity.id, `🚫 הרשומה של ${e.displayName} בוטלה (השיבוץ הוסר)`, {
      event: 'entry_cancelled',
      reason: 'assignment_removed',
      externalPersonId: e.externalPersonId,
    });
    changed = true;
  }

  // DRAFT auto-recalculation (product rule): a DRAFT entry is an automatically
  // maintained projection — business changes (variant rates, profile
  // supplements, participants, שבת/חג settings) flow into its calculated
  // values, overrides always preserved. Approval is PER ENTRY: in a partially
  // approved activity only the still-draft entries sync; office-approved
  // entries never recalculate automatically (manual edits and the month-gated
  // maintenance recalc only).
  const currentEntries = await client.payrollEntry.findMany({
    where: { activityId: activity.id },
    select: { state: true, officeStatus: true },
  });
  const officeState = deriveOfficeState(currentEntries);
  if (activity.state === 'active' && officeState !== 'office_approved') {
    // Draft-era attributes follow the tour (date moves, product/location
    // rename): the activity is a projection until fully office-approved.
    const desired = { titleHe: tourTitle(tour), date: tour.date, payrollMonth: monthOf(tour.date) };
    if (
      activity.titleHe !== desired.titleHe ||
      activity.date !== desired.date ||
      activity.payrollMonth !== desired.payrollMonth
    ) {
      await client.payrollActivity.update({ where: { id: activity.id }, data: desired });
    }
  }
  if (activity.state === 'active') {
    const fresh = await client.payrollActivity.findUnique({
      where: { id: activity.id },
      include: {
        entries: { where: { state: 'active', officeStatus: 'draft' }, include: { lines: true } },
      },
    });
    let totalChanges = 0;
    for (const entry of fresh.entries) {
      const person = personByExt.get(entry.externalPersonId);
      const fullInputs = {
        ...tourInputs,
        role: entry.role,
        seniorityIls: person?.profile?.senioritySupplement ?? null,
        travelAllowanceIls: person?.profile?.travelAllowance ?? null,
      };
      const freshLines = buildEntryLines({ source: 'tour', components, inputs: fullInputs });
      const lineChanges = await syncEntryLines(client, entry, freshLines);
      if (lineChanges.length) {
        totalChanges += lineChanges.length;
        await client.payrollEntry.update({
          where: { id: entry.id },
          data: {
            vatStatusSnapshot: person?.profile?.vatStatus === 'vat_18' ? 'vat_18' : 'exempt',
            vatRateSnapshot: vatRatePercent(),
            engineVersion: ENGINE_VERSION,
            calcSnapshot: snapshotOf('tour', fullInputs),
          },
        });
      }
    }
    // One aggregate history event, and only when something actually changed —
    // idle drawer opens never flood the audit trail.
    if (totalChanges > 0) {
      await emitPayrollEvent(client, activity.id, `🔄 חישובי הטיוטה עודכנו אוטומטית (${totalChanges} רכיבים)`, {
        event: 'draft_auto_recalculated',
        changedLines: totalChanges,
      });
    }
  }

  return client.payrollActivity.findUnique({
    where: { id: activity.id },
    include: { entries: { include: { lines: true } } },
  });
}

// Bring an entry's lines to the engine's fresh output: update calculatedMinor
// where it drifted, ADD lines for catalog components that didn't exist when
// the entry was created. Overrides and notes are never touched. Returns the
// change list (empty → nothing persisted).
export async function syncEntryLines(client, entry, freshLines) {
  const byComponent = new Map((entry.lines || []).map((l) => [l.componentId, l]));
  const changes = [];
  for (const fresh of freshLines) {
    const existing = byComponent.get(fresh.componentId);
    if (!existing) {
      await client.payrollEntryLine.create({
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
      await client.payrollEntryLine.update({
        where: { id: existing.id },
        data: { calculatedMinor: next },
      });
      changes.push({ component: existing.componentNameHe, from: cur, to: next });
    }
  }
  return changes;
}

// ═══ Office approval (selective, entry-level truth) ═══
// THE approval write path. Bulk "אשר שכר" and the per-person control both go
// through here — one service, one truth (PayrollEntry.officeStatus). Entries
// with nothing to pay (all-zero finals) are never silently approved: they are
// reported back as skipped and stay draft.
export async function approveEntries(client, { activityId, entryIds = null, origin = null }) {
  const activity = await client.payrollActivity.findUnique({
    where: { id: activityId },
    include: { entries: { include: { lines: true } } },
  });
  if (!activity) return { error: 'not_found' };
  if (activity.state !== 'active') return { error: 'activity_cancelled' };
  const candidates = activity.entries.filter(
    (e) =>
      e.state === 'active' &&
      e.officeStatus !== 'approved' &&
      (entryIds == null || entryIds.includes(e.id)),
  );
  const approved = [];
  const skipped = [];
  const by = origin?.createdByName || null;
  for (const e of candidates) {
    if (!entryApprovable(e.lines)) {
      skipped.push({ entryId: e.id, displayName: e.displayName, reason: 'zero_total' });
      continue;
    }
    await client.payrollEntry.update({
      where: { id: e.id },
      data: { officeStatus: 'approved', officeApprovedAt: new Date(), officeApprovedBy: by },
    });
    approved.push({ entryId: e.id, displayName: e.displayName, externalPersonId: e.externalPersonId });
  }
  if (approved.length) {
    await emitTimelineEvent(client, {
      subjectType: PAYROLL_SUBJECT,
      subjectId: activity.id,
      kind: 'payroll',
      body: `✅ אושר שכר במשרד עבור: ${approved.map((a) => a.displayName).join(', ')}`,
      data: { event: 'office_approved_entries', entryIds: approved.map((a) => a.entryId) },
      origin: origin || systemOrigin(),
    });
    emitPayrollChanged(client, {
      activityId: activity.id,
      externalPersonIds: approved.map((a) => a.externalPersonId),
      reason: 'office_approved',
    });
  }
  return { approved, skipped };
}

// Remove office approval from ONE entry (hides it from the guide again).
// The guide-side state resets — a stale guide approval must not survive.
export async function unapproveEntry(client, { entryId, origin = null }) {
  const entry = await client.payrollEntry.findUnique({
    where: { id: entryId },
    include: { activity: true },
  });
  if (!entry) return { error: 'not_found' };
  if (entry.officeStatus !== 'approved') return { already: true };
  await client.payrollEntry.update({
    where: { id: entry.id },
    data: {
      officeStatus: 'draft',
      officeApprovedAt: null,
      officeApprovedBy: null,
      guideStatus: 'pending',
      guideApprovedAt: null,
    },
  });
  await emitTimelineEvent(client, {
    subjectType: PAYROLL_SUBJECT,
    subjectId: entry.activityId,
    kind: 'payroll',
    body: `↩️ הוסר אישור המשרד עבור ${entry.displayName}`,
    data: { event: 'office_unapproved_entry', entryId: entry.id },
    origin: origin || systemOrigin(),
  });
  emitPayrollChanged(client, {
    activityId: entry.activityId,
    entryId: entry.id,
    externalPersonId: entry.externalPersonId,
    reason: 'office_unapproved',
  });
  return { ok: true };
}

// ═══ Void (accidental rows) — destructive-looking, never destructive ═══
// Nothing is ever deleted: state flips to 'voided', which every total /
// report / portal query already excludes (they all filter state='active').
// Lines, snapshots, comments and timeline stay intact; the event records who
// voided, when, and why.
export async function voidEntry(client, { entryId, reason = null, origin = null }) {
  const entry = await client.payrollEntry.findUnique({ where: { id: entryId } });
  if (!entry) return { error: 'not_found' };
  if (entry.state === 'voided') return { already: true };
  await client.payrollEntry.update({ where: { id: entry.id }, data: { state: 'voided' } });
  await emitTimelineEvent(client, {
    subjectType: PAYROLL_SUBJECT,
    subjectId: entry.activityId,
    kind: 'payroll',
    body: `🗑️ רשומת השכר של ${entry.displayName} בוטלה${reason ? ` — ${reason}` : ''}`,
    data: { event: 'entry_voided', entryId: entry.id, reason },
    origin: origin || systemOrigin(),
  });
  emitPayrollChanged(client, {
    activityId: entry.activityId,
    entryId: entry.id,
    externalPersonId: entry.externalPersonId,
    reason: 'entry_voided',
  });
  return { ok: true };
}

// Void a whole activity (an accidentally-created General Activity, or a tour
// payroll that should never pay) — voids every non-voided entry through the
// SAME semantics, one canonical service.
export async function voidActivity(client, { activityId, reason = null, origin = null }) {
  const activity = await client.payrollActivity.findUnique({
    where: { id: activityId },
    include: { entries: { select: { id: true, state: true } } },
  });
  if (!activity) return { error: 'not_found' };
  if (activity.state === 'voided') return { already: true };
  await client.payrollActivity.update({ where: { id: activity.id }, data: { state: 'voided' } });
  await client.payrollEntry.updateMany({
    where: { activityId: activity.id, state: { not: 'voided' } },
    data: { state: 'voided' },
  });
  await emitTimelineEvent(client, {
    subjectType: PAYROLL_SUBJECT,
    subjectId: activity.id,
    kind: 'payroll',
    body: `🗑️ פעילות השכר בוטלה${reason ? ` — ${reason}` : ''}`,
    data: { event: 'activity_voided', reason, entryCount: activity.entries.length },
    origin: origin || systemOrigin(),
  });
  emitPayrollChanged(client, { activityId: activity.id, reason: 'activity_voided' });
  return { ok: true };
}

// ═══ Push-based DRAFT reconciliation ═══
// The rule: whenever a payroll-relevant mutation SUCCEEDS, the affected DRAFT
// activities reconcile immediately in the background — payroll is an
// automatically maintained projection of tour state, correct BEFORE anyone
// opens the screen. Office-approved activities are never touched (values
// change only by manual edit). ensureTourPayroll stays the ONE reconcile
// implementation; these are only scoped dispatchers around it. The lazy
// reconcile on the day screen / drawer remains as a safety net for old data
// and unhooked edge paths — under normal operation it finds nothing to do.

// Fire-and-forget kick for route handlers: runs AFTER the mutation's own DB
// writes, on the root prisma client (never inside the caller's transaction),
// and never throws into the request.
export function kickPayrollReconcile(scope, ref = null) {
  const run = async () => {
    if (scope === 'tour' && ref) {
      await ensureTourPayroll(prisma, ref);
    } else if (scope === 'personRef' && ref) {
      await reconcileDraftsForPersonRef(prisma, ref);
    } else if (scope === 'variant' && ref) {
      await reconcileDraftsForVariant(prisma, ref);
    } else if (scope === 'all') {
      await reconcileAllDrafts(prisma);
    }
  };
  run().catch((e) => console.warn(`[payroll] reconcile(${scope}) failed:`, e.message));
}

// General (non-tour) draft entries reconcile per entry via recalcEntry —
// same engine, same snapshot rules — with the same aggregate history event
// the tour draft-sync emits (and only when something actually changed).
// Approval is per entry: only still-draft entries sync.
async function reconcileGeneralDraftActivity(client, activity) {
  const entries = await client.payrollEntry.findMany({
    where: { activityId: activity.id, state: 'active', officeStatus: 'draft' },
    select: { id: true },
  });
  let totalChanges = 0;
  for (const e of entries) {
    const result = await recalcEntry(client, e.id);
    if (!result.error) totalChanges += result.changes.length;
  }
  if (totalChanges > 0) {
    await emitPayrollEvent(client, activity.id, `🔄 חישובי הטיוטה עודכנו אוטומטית (${totalChanges} רכיבים)`, {
      event: 'draft_auto_recalculated',
      changedLines: totalChanges,
    });
  }
  return totalChanges;
}

// A person's payroll facts changed (vatStatus / ותק / נסיעות) → reconcile
// every DRAFT activity that has an entry for them.
export async function reconcileDraftsForPersonRef(client, personRefId) {
  const person = await client.personRef.findUnique({
    where: { id: personRefId },
    select: { externalPersonId: true },
  });
  if (!person) return;
  const entries = await client.payrollEntry.findMany({
    where: {
      externalPersonId: person.externalPersonId,
      state: 'active',
      officeStatus: 'draft',
      activity: { state: 'active' },
    },
    select: { activity: { select: { id: true, sourceType: true, tourEventId: true } } },
  });
  const seen = new Set();
  for (const { activity } of entries) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    if (activity.sourceType === 'tour_event' && activity.tourEventId) {
      await ensureTourPayroll(client, activity.tourEventId);
    } else {
      await reconcileGeneralDraftActivity(client, activity);
    }
  }
}

// A variant's pay rates changed → reconcile every DRAFT tour activity whose
// tour uses that variant.
export async function reconcileDraftsForVariant(client, productVariantId) {
  const activities = await client.payrollActivity.findMany({
    where: {
      state: 'active',
      sourceType: 'tour_event',
      tourEvent: { productVariantId },
      entries: { some: { state: 'active', officeStatus: 'draft' } },
    },
    select: { tourEventId: true },
  });
  for (const a of activities) {
    if (a.tourEventId) await ensureTourPayroll(client, a.tourEventId);
  }
}

// A global rule changed (component catalog, שבת/חג settings) → reconcile every
// DRAFT activity. Drafts are the current working period, so this set is small
// by construction; the limit is a runaway backstop, not an operating bound.
export async function reconcileAllDrafts(client, { limit = 500 } = {}) {
  const drafts = await client.payrollActivity.findMany({
    where: { state: 'active', entries: { some: { state: 'active', officeStatus: 'draft' } } },
    select: { id: true, sourceType: true, tourEventId: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  for (const a of drafts) {
    if (a.sourceType === 'tour_event' && a.tourEventId) {
      await ensureTourPayroll(client, a.tourEventId);
    } else {
      await reconcileGeneralDraftActivity(client, a);
    }
  }
}

// TRUE recalculation from CURRENT business rules — the admin MAINTENANCE
// action (e.g. after fixing the payroll engine). Not exposed in normal UI;
// the route gates it to the current + previous payroll month. Emits no events
// itself — the caller owns attribution and guide-reapproval consequences.
export async function recalcEntry(client, entryId) {
  const entry = await client.payrollEntry.findUnique({
    where: { id: entryId },
    include: { lines: true, activity: true },
  });
  if (!entry) return { error: 'not_found' };
  const activity = entry.activity;
  const person = await client.personRef.findUnique({
    where: { externalPersonId: entry.externalPersonId },
    include: { profile: true },
  });
  const components = await loadComponents(client);

  let source;
  let inputs;
  if (activity.sourceType === 'tour_event' && activity.tourEventId) {
    const tour = await client.tourEvent.findUnique({
      where: { id: activity.tourEventId },
      include: {
        productVariant: { select: { baseGuidePaymentMinor: true, travelPaymentMinor: true } },
        bookings: { select: { status: true, seats: true, deal: { select: { participants: true } } } },
      },
    });
    if (!tour) return { error: 'tour_missing' };
    source = 'tour';
    inputs = {
      ...(await buildTourInputs(client, tour, components)),
      role: entry.role,
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

  const freshLines = buildEntryLines({ source, components, inputs });
  const changes = await syncEntryLines(client, entry, freshLines);
  await client.payrollEntry.update({
    where: { id: entry.id },
    data: {
      vatStatusSnapshot: person?.profile?.vatStatus === 'vat_18' ? 'vat_18' : entry.vatStatusSnapshot,
      vatRateSnapshot: vatRatePercent(),
      engineVersion: ENGINE_VERSION,
      calcSnapshot: snapshotOf(source, inputs),
    },
  });
  return { changes, entry };
}

// Reopen/cancel path — the tour is no longer completed; payroll history is
// preserved and parked as 'cancelled'.
export async function cancelTourPayroll(client, tourEventId, reason) {
  const activity = await client.payrollActivity.findUnique({ where: { tourEventId } });
  if (!activity || activity.state === 'cancelled') return null;
  await client.payrollActivity.update({
    where: { id: activity.id },
    data: { state: 'cancelled' },
  });
  await client.payrollEntry.updateMany({
    where: { activityId: activity.id, state: 'active' },
    data: { state: 'cancelled' },
  });
  await emitPayrollEvent(
    client,
    activity.id,
    reason === 'tour_reopened'
      ? '↩️ פעילות השכר בוטלה — הסיור הוחזר לסטטוס "מתוכנן"'
      : '🚫 פעילות השכר בוטלה — הסיור בוטל',
    { event: 'cancelled', reason },
  );
  return activity.id;
}

// Create a General Activity + its PayrollActivity + one entry per selected
// staff member. Rows carry the per-person dialog values (unit price, generic
// quantity units, quick addition/deduction, note). Created as DRAFT — office
// approval stays ONE activity-level action in the drawer.
export async function createGeneralActivity(client, { typeId, payrollMonth, date = null, notes = null, rows = [], origin = null }) {
  const type = await client.generalActivityType.findUnique({ where: { id: typeId } });
  if (!type) return { error: 'type_not_found' };
  if (!/^\d{4}-\d{2}$/.test(String(payrollMonth || ''))) return { error: 'invalid_month' };
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { error: 'invalid_date' };
  const deduped = [...new Map(rows.map((r) => [String(r.externalPersonId), r])).values()];
  if (deduped.length === 0) return { error: 'no_rows' };

  // Canonical eligibility gate (people/eligibility.js — the SAME rule Tour
  // assignment enforces): only active staff/trainees may receive payroll
  // entries. A crafted request naming a departed person is rejected here
  // regardless of the UI.
  const eligibilityRows = await client.personRef.findMany({
    where: { externalPersonId: { in: deduped.map((r) => String(r.externalPersonId)) } },
    select: { externalPersonId: true, status: true, lifecycleHint: true },
  });
  const eligibleByExt = new Map(eligibilityRows.map((p) => [p.externalPersonId, p]));
  for (const row of deduped) {
    const person = eligibleByExt.get(String(row.externalPersonId));
    if (!person || !isAssignableStaff(person)) {
      return { error: 'person_not_assignable' };
    }
  }

  const general = await client.generalActivity.create({
    data: { typeId: type.id, titleHe: type.nameHe, payrollMonth, date, notes },
  });
  const activity = await client.payrollActivity.create({
    data: {
      sourceType: 'general',
      generalActivityId: general.id,
      titleHe: type.nameHe,
      payrollMonth,
      date,
    },
  });

  const components = await loadComponents(client);
  const persons = await client.personRef.findMany({
    where: { externalPersonId: { in: deduped.map((r) => String(r.externalPersonId)) } },
    include: { profile: true },
  });
  const personByExt = new Map(persons.map((p) => [p.externalPersonId, p]));

  for (const row of deduped) {
    const ext = String(row.externalPersonId);
    const person = personByExt.get(ext);
    const entry = await createEntry(client, {
      activity,
      source: 'general',
      person: {
        personRefId: person?.id || null,
        externalPersonId: ext,
        displayName: person?.displayName || String(row.displayName || ext),
        profile: person?.profile || null,
      },
      role: null,
      tourAssignmentId: null,
      components,
      inputs: {
        unitPriceMinor: Math.round(Number(row.unitPriceMinor) || 0),
        quantity: Number(row.quantity) || 0,
      },
    });
    // Quick manual values from the dialog land as OVERRIDES on the system
    // manual rows (same semantics as editing the matrix afterwards).
    const overridesByKey = new Map();
    if (Number(row.additionMinor) > 0) overridesByKey.set('addition', Math.round(Number(row.additionMinor)));
    if (Number(row.deductionMinor) > 0) overridesByKey.set('deduction', Math.round(Number(row.deductionMinor)));
    if (overridesByKey.size) {
      const keyByComponentId = new Map(components.map((c) => [c.id, c.key]));
      for (const line of entry.lines) {
        const key = keyByComponentId.get(line.componentId);
        if (key && overridesByKey.has(key)) {
          await client.payrollEntryLine.update({
            where: { id: line.id },
            data: { overrideMinor: overridesByKey.get(key) },
          });
        }
      }
    }
    if (row.note) {
      await client.payrollEntry.update({ where: { id: entry.id }, data: { notes: String(row.note) } });
    }
  }

  await emitTimelineEvent(client, {
    subjectType: PAYROLL_SUBJECT,
    subjectId: activity.id,
    kind: 'payroll',
    body: `🧾 נוצרה תוספת כללית: ${type.nameHe} (${deduped.length} אנשי צוות)`,
    data: { event: 'created', sourceType: 'general', generalActivityId: general.id },
    origin: origin || systemOrigin(),
  });
  emitPayrollChanged(client, {
    activityId: activity.id,
    externalPersonIds: deduped.map((r) => String(r.externalPersonId)),
    reason: 'activity_created',
  });
  return { activityId: activity.id };
}

// Ensure payroll exists for every completed tour on a calendar day — the day
// screen's lazy materialisation (also the backfill path for tours completed
// before the module existed).
export async function ensureDayPayroll(client, dateISO) {
  const tours = await client.tourEvent.findMany({
    // Migration-owned tours carry frozen imported payroll — excluded here AND
    // guarded again inside ensureTourPayroll (defense in depth).
    where: { status: 'completed', date: dateISO, NOT: { completedReason: 'migration' } },
    select: { id: true },
  });
  for (const t of tours) {
    await ensureTourPayroll(client, t.id);
  }
  return tours.length;
}
