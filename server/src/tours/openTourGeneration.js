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
import { seedSlotComponents } from './tourComponents.js';

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
function baseProductOf(template) {
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

// Generate any missing open-tour slots inside the horizon. Returns the number
// created.
export async function ensureOpenTourSlots(client) {
  const templates = await client.openTourTemplate.findMany({
    where: { active: true },
    include: {
      scheduleRules: { where: { active: true } },
      exceptions: true,
      products: {
        include: {
          productVariant: {
            select: {
              productId: true,
              locationId: true,
              // isWorkshop of each default component → pick the PLAIN base.
              activityComponents: { select: { activityComponent: { select: { isWorkshop: true } } } },
            },
          },
        },
      },
    },
  });
  if (!templates.length) return 0;

  const settings = await getTourSettings(client);
  const today = israelToday();
  const target = addDays(today, settings.generateDaysAhead);

  const allRows = [];
  const cursorPatches = [];
  // Per (generatedByRuleId → variantId) so freshly created slots seed their
  // components from the base product's variant defaults.
  const seedBatches = [];

  for (const tpl of templates) {
    const base = baseProductOf(tpl);
    const capacity = tpl.capacity != null ? tpl.capacity : settings.defaultCapacity;
    const locationId = tpl.locationId || base?.variantLocationId || null;

    const { rows, cursorPatches: patches } = planTemplateGeneration(tpl, { today, target });
    cursorPatches.push(...patches);

    const datesByRule = new Map();
    for (const r of rows) {
      allRows.push({
        kind: 'group_slot',
        status: 'scheduled',
        date: r.date,
        startTime: r.startTime,
        productId: base?.productId || null,
        productVariantId: base?.productVariantId || null,
        locationId,
        tourLanguage: tpl.tourLanguage,
        capacity,
        openTourTemplateId: tpl.id,
        generatedByRuleId: r.generatedByRuleId,
      });
      if (!datesByRule.has(r.generatedByRuleId)) datesByRule.set(r.generatedByRuleId, []);
      datesByRule.get(r.generatedByRuleId).push(r.date);
    }
    if (base?.productVariantId) {
      for (const [ruleId, dates] of datesByRule) {
        seedBatches.push({ ruleId, variantId: base.productVariantId, dates });
      }
    }
  }

  let created = 0;
  if (allRows.length) {
    const res = await client.tourEvent.createMany({ data: allRows, skipDuplicates: true });
    created = res.count;
    for (const b of seedBatches) {
      await seedSlotComponents(client, b.ruleId, b.variantId, b.dates);
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

// Orchestrator called from the tours router (sync-on-read). The legacy
// TourScheduleRule generator has been RETIRED — the Open Tours engine is now the
// ONE and ONLY recurring-slot generator (guards against double generation). Kept
// as a named seam so the router call sites (and any future generators) stay
// stable and idempotent; failures are logged by the caller and never block.
export async function ensureTourSlots(client) {
  return ensureOpenTourSlots(client);
}
