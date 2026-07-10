// Automatic group-slot generation — materializes TourEvents from the active
// TourScheduleRules as dates enter the configured horizon. Runs sync-on-read
// from the tours list (the module's established freshness pattern, like the
// people module) and after rule mutations, so the schedule is always current
// without a background worker.
//
// Idempotency is two-layered:
//   1. Each rule's `generatedThrough` cursor — generation only creates dates
//      BEYOND it, so a generated slot the operator deleted is never
//      resurrected (the range was already covered).
//   2. The TourEvent (generatedByRuleId, date) unique + skipDuplicates —
//      guards concurrent requests racing on the same range.

import { seedSlotComponents } from './tourComponents.js';

// Israel-local calendar date (server runs UTC) — "YYYY-MM-DD".
export function israelToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sunday
}

// Lazily-created settings singleton — the ONE accessor.
export async function getTourSettings(client) {
  return client.tourSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}

// Generate any missing slots inside the horizon. Returns the number created.
export async function ensureGeneratedSlots(client) {
  const rules = await client.tourScheduleRule.findMany({
    where: { active: true },
    include: { productVariant: { select: { locationId: true } } },
  });
  if (!rules.length) return 0;

  const settings = await getTourSettings(client);
  const today = israelToday();
  const target = addDays(today, settings.generateDaysAhead);

  const rows = [];
  const cursorPatches = [];
  // Dates generated per rule this run — used to seed the new slots' components
  // from the rule's product defaults. Safe to target these exact (rule, date)
  // pairs: the cursor guarantees they are freshly created, never revisited.
  const generatedByRule = [];
  for (const rule of rules) {
    // A rule missing its catalog refs (product deleted) cannot mint valid
    // slots — skip it without moving the cursor, so fixing the rule resumes
    // generation from where it stopped.
    if (!rule.productId || !rule.productVariantId) continue;
    // Start after the cursor, never before today (the past is not schedulable).
    let from = rule.generatedThrough ? addDays(rule.generatedThrough, 1) : today;
    if (from < today) from = today;
    if (from > target) continue;
    const ruleDates = [];
    for (let d = from; d <= target; d = addDays(d, 1)) {
      if (weekdayOf(d) !== rule.weekday) continue;
      ruleDates.push(d);
      rows.push({
        kind: 'group_slot',
        status: 'scheduled',
        date: d,
        startTime: rule.startTime,
        productId: rule.productId,
        productVariantId: rule.productVariantId,
        locationId: rule.productVariant?.locationId || null,
        tourLanguage: rule.tourLanguage,
        capacity: rule.capacity,
        generatedByRuleId: rule.id,
      });
    }
    if (ruleDates.length)
      generatedByRule.push({ ruleId: rule.id, productVariantId: rule.productVariantId, dates: ruleDates });
    cursorPatches.push({ id: rule.id, generatedThrough: target });
  }

  let created = 0;
  if (rows.length) {
    const res = await client.tourEvent.createMany({ data: rows, skipDuplicates: true });
    created = res.count;
    // Seed the newly-created slots' activity components from the product
    // defaults (Slice C). After createMany the ids aren't returned, so we look
    // the batch back up by (rule, date) inside the seeder.
    for (const g of generatedByRule) {
      await seedSlotComponents(client, g.ruleId, g.productVariantId, g.dates);
    }
  }
  for (const p of cursorPatches) {
    await client.tourScheduleRule.update({
      where: { id: p.id },
      data: { generatedThrough: p.generatedThrough },
    });
  }
  return created;
}
