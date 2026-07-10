import { seedRowsFromDefaults } from './activityCatalog.js';

// DB seeding of a TourEvent's activity components from its Product's defaults.
// Called at the TWO tour-creation points (private/business via tourFromDeal,
// group slots via slotGeneration). Seeding is a COPY: after creation the tour
// owns its components and later Product-default edits never touch it.

async function productDefaultIds(client, productId) {
  const defaults = await client.productActivityComponent.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
    select: { activityComponentId: true },
  });
  return defaults.map((d) => d.activityComponentId);
}

// Seed ONE freshly-created tour from its product defaults. No-op when the
// product has no defaults. Runs inside the caller's transaction.
export async function seedTourComponents(client, tourEventId, productId) {
  if (!productId) return 0;
  const ids = await productDefaultIds(client, productId);
  if (!ids.length) return 0;
  const data = seedRowsFromDefaults(ids, tourEventId);
  await client.tourEventActivityComponent.createMany({ data, skipDuplicates: true });
  return data.length;
}

// Seed a batch of freshly-generated group slots for one schedule rule. Only
// slots that currently have ZERO components are seeded (idempotent safety on top
// of the generation cursor, which already never revisits a date).
export async function seedSlotComponents(client, ruleId, productId, dates) {
  if (!productId || !dates?.length) return 0;
  const ids = await productDefaultIds(client, productId);
  if (!ids.length) return 0;
  const slots = await client.tourEvent.findMany({
    where: { generatedByRuleId: ruleId, date: { in: dates } },
    select: { id: true, _count: { select: { activityComponents: true } } },
  });
  const data = [];
  for (const s of slots) {
    if (s._count.activityComponents > 0) continue;
    for (const row of seedRowsFromDefaults(ids, s.id)) data.push(row);
  }
  if (data.length) await client.tourEventActivityComponent.createMany({ data, skipDuplicates: true });
  return data.length;
}
