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
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { sabbathHolidayWindow } from '../pricing/engine.js';
import { vatRatePercent } from '../icountDocs.js';
import { ENGINE_VERSION, buildEntryLines } from './engine.js';

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
// (pricing/engine.js sabbathHolidayWindow) and the global rules, exactly like
// pricingCalc. Never re-implemented.
export async function isWeekendHoliday(client, dateISO, startTime) {
  if (!dateISO) return false;
  const dt = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return false;
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
  return sabbathHolidayWindow({ weekday, minuteOfDay, dateISO }, { weekly, holidays }).applies;
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

async function emitPayrollEvent(client, activityId, body, data, origin = null) {
  await emitTimelineEvent(client, {
    subjectType: PAYROLL_SUBJECT,
    subjectId: activityId,
    kind: 'payroll',
    body,
    data,
    origin: origin || systemOrigin(),
  });
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
      calcSnapshot: {
        engineVersion: ENGINE_VERSION,
        at: new Date().toISOString(),
        source,
        inputs: JSON.parse(JSON.stringify(fullInputs, (k, v) => (typeof v === 'bigint' ? Number(v) : v))),
      },
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

  let activity = tour.payrollActivity;
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

  // Reconcile entries against current assignments (by stable externalPersonId).
  const components = await loadComponents(client);
  const persons = tour.assignments.length
    ? await client.personRef.findMany({
        where: { externalPersonId: { in: tour.assignments.map((a) => a.externalPersonId) } },
        include: { profile: true },
      })
    : [];
  const personByExt = new Map(persons.map((p) => [p.externalPersonId, p]));
  const entryByExt = new Map(activity.entries.map((e) => [e.externalPersonId, e]));
  const tourInputs = {
    baseGuidePaymentMinor: tour.productVariant?.baseGuidePaymentMinor ?? null,
    variantTravelMinor: tour.productVariant?.travelPaymentMinor ?? null,
    participants: participantsTotal(tour.bookings),
    isWeekendHoliday: await isWeekendHoliday(client, tour.date, tour.startTime),
  };

  let changed = false;
  for (const a of tour.assignments) {
    const existing = entryByExt.get(a.externalPersonId);
    if (existing) {
      if (existing.state === 'cancelled') {
        await client.payrollEntry.update({
          where: { id: existing.id },
          data: { state: 'active', tourAssignmentId: a.id, role: a.role },
        });
        await emitPayrollEvent(client, activity.id, `↩️ הרשומה של ${a.displayName} הוחזרה לפעילה (שובץ מחדש)`, {
          event: 'entry_reactivated',
          externalPersonId: a.externalPersonId,
        });
        changed = true;
      }
      continue;
    }
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
  // Assignment removed after entries existed → cancel (NEVER delete).
  const assignedExt = new Set(tour.assignments.map((a) => a.externalPersonId));
  for (const e of activity.entries) {
    if (e.state === 'active' && e.tourAssignmentId && !assignedExt.has(e.externalPersonId)) {
      await client.payrollEntry.update({ where: { id: e.id }, data: { state: 'cancelled' } });
      await emitPayrollEvent(client, activity.id, `🚫 הרשומה של ${e.displayName} בוטלה (השיבוץ הוסר)`, {
        event: 'entry_cancelled',
        reason: 'assignment_removed',
        externalPersonId: e.externalPersonId,
      });
      changed = true;
    }
  }

  if (!changed && activity.entries.length === 0 && tour.assignments.length === 0) {
    // A completed tour with no staff at all still has an activity (status
    // "חסר שכר" derives from having no active entries).
  }
  return client.payrollActivity.findUnique({
    where: { id: activity.id },
    include: { entries: { include: { lines: true } } },
  });
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
    body: `🧾 נוצרה פעילות כללית: ${type.nameHe} (${deduped.length} אנשי צוות)`,
    data: { event: 'created', sourceType: 'general', generalActivityId: general.id },
    origin: origin || systemOrigin(),
  });
  return { activityId: activity.id };
}

// Ensure payroll exists for every completed tour on a calendar day — the day
// screen's lazy materialisation (also the backfill path for tours completed
// before the module existed).
export async function ensureDayPayroll(client, dateISO) {
  const tours = await client.tourEvent.findMany({
    where: { status: 'completed', date: dateISO },
    select: { id: true },
  });
  for (const t of tours) {
    await ensureTourPayroll(client, t.id);
  }
  return tours.length;
}
