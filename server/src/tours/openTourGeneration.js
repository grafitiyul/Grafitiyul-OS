// Open Tour generation — materializes TourEvents (kind='group_slot') from
// OpenTourTemplate × OpenTourScheduleRule − OpenTourScheduleException, as dates
// enter the horizon (TourSettings.generateDaysAhead). Same idempotency contract
// as the legacy slot generator:
//   1. Each rule's `generatedThrough` forward cursor — only dates BEYOND it are
//      created, so a slot the operator deleted is never resurrected.
//   2. TourEvent (generatedByRuleId, date) unique + skipDuplicates — guards
//      concurrent runs.
// The generated slot carries the template's BASE (isDefault) product as its
// zero-registration operational product; registration-driven derivation
// (later slice) refines it. NOTHING here encodes a product name/id.
//
// This runs ALONGSIDE the legacy TourScheduleRule generator during the
// transition (a template with zero rules is a no-op). Once schedules are
// authored as templates and the legacy rules deactivated, the legacy path is
// retired.

import { israelToday, addDays, weekdayOf, getTourSettings } from './slotGeneration.js';
import { ensureCanonicalSlot, requiredSlotsForDate } from './canonicalSlot.js';
import { calendarPendingPatch } from './calendar/service.js';
import { wooPendingPatch } from './woo/service.js';

// Shared include for loading a template with everything the canonical slot spec
// needs (schedule rules, exceptions, and each offered product's variant + its
// default components, to pick the PLAIN base product).
export const TEMPLATE_GEN_INCLUDE = {
  scheduleRules: { where: { active: true } },
  exceptions: true,
  products: {
    include: {
      productVariant: {
        select: {
          productId: true,
          locationId: true,
          activityComponents: { select: { activityComponent: { select: { isWorkshop: true } } } },
        },
      },
    },
  },
};

// Synthetic generatedByRuleId for a one-off `add` occurrence, so it shares the
// (generatedByRuleId, date) idempotency guard with rule-generated slots.
export function addExceptionRuleId(exceptionId) {
  return `exc:${exceptionId}`;
}

// PURE planner: given a template's active schedule rules + exceptions and the
// [today, target] horizon, return the concrete rows to create and the per-rule
// cursor advances. No DB, no product/variant resolution — fully unit-testable.
//   scheduleRules: [{ id, weekday, startTime, validFrom?, validUntil?, generatedThrough? }]
//   exceptions:    [{ id, date, type: 'add'|'cancel'|'time_override', time? }]
// Returns { rows: [{ generatedByRuleId, date, startTime }], cursorPatches: [{ id, generatedThrough }] }
export function planTemplateGeneration(template, { today, target }) {
  const scheduleRules = template.scheduleRules || [];
  const exceptions = template.exceptions || [];

  const cancelDates = new Set(exceptions.filter((e) => e.type === 'cancel').map((e) => e.date));
  const timeOverrides = new Map(
    exceptions.filter((e) => e.type === 'time_override' && e.time).map((e) => [e.date, e.time]),
  );
  const addExceptions = exceptions.filter((e) => e.type === 'add');

  const rows = [];
  const cursorPatches = [];

  for (const rule of scheduleRules) {
    // Start after the cursor, never before today (the past is not schedulable);
    // clamp to the rule's validity window.
    let from = rule.generatedThrough ? addDays(rule.generatedThrough, 1) : today;
    if (from < today) from = today;
    if (rule.validFrom && from < rule.validFrom) from = rule.validFrom;
    let to = target;
    if (rule.validUntil && rule.validUntil < to) to = rule.validUntil;

    if (from <= to) {
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (weekdayOf(d) !== rule.weekday) continue;
        if (cancelDates.has(d)) continue;
        rows.push({
          generatedByRuleId: rule.id,
          date: d,
          startTime: timeOverrides.get(d) || rule.startTime,
        });
      }
    }
    // Always ratchet the cursor to the horizon — dates beyond validUntil are
    // simply never emitted, so nothing is lost and re-scans are avoided.
    cursorPatches.push({ id: rule.id, generatedThrough: target });
  }

  // One-off extra occurrences — independent of any weekday rule. Only future
  // dates with an explicit time, and never one that is also cancelled.
  for (const exc of addExceptions) {
    if (!exc.time) continue;
    if (exc.date < today) continue;
    if (cancelDates.has(exc.date)) continue;
    rows.push({
      generatedByRuleId: addExceptionRuleId(exc.id),
      date: exc.date,
      startTime: exc.time,
    });
  }

  return { rows, cursorPatches };
}

// Resolve a template's PLAIN BASE operational product into the product/variant/
// location a freshly generated (zero-registration) slot is stamped with. Base =
// the offered variant with NO isWorkshop component (0 workshop tickets → plain
// tour), preferring isDefault among those; only if EVERY offered product is a
// workshop one does it fall back to isDefault/first. Returns null when the
// template offers no product. Mirrors resolveBaseVariantId (derivation) so a
// generated slot and its derived empty-state agree.
export function baseProductOf(template) {
  const products = (template.products || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((p) => p.productVariantId && p.productVariant);
  if (!products.length) return null;
  const hasWorkshop = (p) =>
    (p.productVariant.activityComponents || []).some((c) => c.activityComponent?.isWorkshop);
  const plain = products.filter((p) => !hasWorkshop(p));
  const pool = plain.length ? plain : products;
  const chosen = pool.find((p) => p.isDefault) || pool[0];
  return {
    productVariantId: chosen.productVariantId,
    productId: chosen.productVariant.productId || null,
    variantLocationId: chosen.productVariant.locationId || null,
  };
}

// Build the canonical slot spec for a planned row (base product, capacity,
// location resolved from the template).
function slotSpec(tpl, base, capacity, locationId, row) {
  return {
    openTourTemplateId: tpl.id,
    date: row.date,
    startTime: row.startTime,
    generatedByRuleId: row.generatedByRuleId,
    productId: base?.productId || null,
    productVariantId: base?.productVariantId || null,
    locationId,
    tourLanguage: tpl.tourLanguage,
    capacity,
  };
}

// Generate any missing open-tour slots inside the horizon. Returns the number
// CREATED (reopened/re-attributed/existing rows are not counted as new). Every
// planned row goes through ensureCanonicalSlot, so generation is idempotent and
// concurrency-safe by construction — the per-rule cursor is now only a scan-
// window optimisation, never the correctness guarantee.
export async function ensureOpenTourSlots(client, { log = console } = {}) {
  const templates = await client.openTourTemplate.findMany({
    where: { active: true },
    include: TEMPLATE_GEN_INCLUDE,
  });
  if (!templates.length) return 0;

  const settings = await getTourSettings(client);
  const today = israelToday();
  const target = addDays(today, settings.generateDaysAhead);

  let created = 0;
  const cursorPatches = [];

  for (const tpl of templates) {
    const base = baseProductOf(tpl);
    const capacity = tpl.capacity != null ? tpl.capacity : settings.defaultCapacity;
    const locationId = tpl.locationId || base?.variantLocationId || null;

    const { rows, cursorPatches: patches } = planTemplateGeneration(tpl, { today, target });
    cursorPatches.push(...patches);

    for (const r of rows) {
      const res = await ensureCanonicalSlot(client, slotSpec(tpl, base, capacity, locationId, r), { log });
      if (res.outcome === 'created') created += 1;
    }
  }

  for (const p of cursorPatches) {
    await client.openTourScheduleRule.update({
      where: { id: p.id },
      data: { generatedThrough: p.generatedThrough },
    });
  }
  return created;
}

// Reconcile the deletion of a schedule EXCEPTION through the canonical path —
// the piece that was missing (deleting a cancel exception left the tour cancelled
// forever, never returning to the site).
//   cancel deleted        → the date's occurrence(s) reopen (canonical reopen of
//                           the cancelled row, preserving its Woo/registration
//                           history), unless another cancel still covers the date
//                           or no active rule generates it.
//   add deleted           → the one-off occurrence it created is cancelled, but
//                           only when EMPTY (registrations/bookings are surfaced,
//                           never silently dropped).
//   time_override deleted → intentionally left to the operator (reverting a live
//                           slot's time can collide with real bookings, as on the
//                           17/07 replacement); logged, not auto-applied.
export async function reconcileExceptionDeletion(client, templateId, exception, { log = console } = {}) {
  const tpl = await client.openTourTemplate.findUnique({
    where: { id: templateId },
    include: TEMPLATE_GEN_INCLUDE,
  });
  if (!tpl || !tpl.active) return { outcome: 'no_template' };

  const timeOverrides = new Map(
    (tpl.exceptions || []).filter((e) => e.type === 'time_override' && e.time).map((e) => [e.date, e.time]),
  );

  if (exception.type === 'cancel') {
    const stillCancelled = (tpl.exceptions || []).some((e) => e.type === 'cancel' && e.date === exception.date);
    if (stillCancelled) return { outcome: 'still_cancelled' };
    const required = requiredSlotsForDate(tpl.scheduleRules, exception.date, timeOverrides);
    if (!required.length) return { outcome: 'no_rule' };
    // Don't disturb a date already served by an active occurrence (e.g. a manual
    // replacement at another time): reopening the old rule-time slot would
    // double-book it. Reopen only when the date has NO active occurrence.
    const activeOnDate = await client.tourEvent.count({
      where: { openTourTemplateId: tpl.id, kind: 'group_slot', date: exception.date, status: { in: ['scheduled', 'completed'] } },
    });
    if (activeOnDate > 0) return { outcome: 'already_served' };
    const settings = await getTourSettings(client);
    const base = baseProductOf(tpl);
    const capacity = tpl.capacity != null ? tpl.capacity : settings.defaultCapacity;
    const locationId = tpl.locationId || base?.variantLocationId || null;
    const results = [];
    for (const row of required) {
      results.push(await ensureCanonicalSlot(client, slotSpec(tpl, base, capacity, locationId, row), { log }));
    }
    return { outcome: 'reopened', results };
  }

  if (exception.type === 'add') {
    const ruleId = addExceptionRuleId(exception.id);
    const slots = await client.tourEvent.findMany({
      where: { openTourTemplateId: templateId, generatedByRuleId: ruleId, status: 'scheduled', kind: 'group_slot' },
      select: { id: true, _count: { select: { ticketRegistrations: true, bookings: true } } },
    });
    let cancelled = 0;
    const kept = [];
    for (const s of slots) {
      if (s._count.ticketRegistrations > 0 || s._count.bookings > 0) {
        kept.push(s.id);
        log?.warn?.(`[exc-delete] add-slot ${s.id} has registrations/bookings — left active for review`);
        continue;
      }
      await client.tourEvent.update({
        where: { id: s.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          ...calendarPendingPatch(),
          ...wooPendingPatch('auto'),
        },
      });
      cancelled += 1;
    }
    return { outcome: 'add_removed', cancelled, kept };
  }

  return { outcome: 'noop', type: exception.type };
}

// Orchestrator called from the tours router (sync-on-read). The legacy
// TourScheduleRule generator has been RETIRED — the Open Tours engine is now the
// ONE and ONLY recurring-slot generator (guards against double generation). Kept
// as a named seam so the router call sites (and any future generators) stay
// stable and idempotent; failures are logged by the caller and never block.
export async function ensureTourSlots(client) {
  return ensureOpenTourSlots(client);
}
