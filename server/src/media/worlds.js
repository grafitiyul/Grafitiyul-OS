// עולם תוכן — Content Worlds.
//
// A world is a BUSINESS DOMAIN (GOS, CHALLENGE): what the content is about.
// ContentWorkspace, which already exists, is an ACCESS boundary: who may see
// it. They stay separate models — collapsing them breaks the moment an external
// Challenge tenant exists, because that tenant is its own workspace while
// internal GOS staff must still see CHALLENGE content without being it.
//
// Organisation rule this module enforces:
//   1. an item belongs to one or more worlds
//   2. a category belongs to exactly one world
//   3. an item may only be filed under categories from ITS OWN worlds
// Rule 3 is enforced HERE, server-side. UI filtering is a convenience, never
// the guarantee.

export const PRIMARY_WORLD_KEY = 'gos';

function fail(code, status = 422, detail = undefined) {
  const err = new Error(code);
  err.status = status;
  if (detail) err.detail = detail;
  throw err;
}

export async function listWorlds(client, { includeInactive = false } = {}) {
  return client.contentWorld.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
  });
}

export async function primaryWorld(client) {
  return client.contentWorld.findUnique({ where: { key: PRIMARY_WORLD_KEY } });
}

/**
 * Resolve the worlds an item should belong to.
 *
 * An item with NO world would be unfileable and invisible in a world-first UI,
 * so an empty selection is rejected rather than silently defaulted — the
 * operator must make the first organisational choice consciously.
 */
export async function resolveWorldIds(client, worldIds) {
  const ids = Array.isArray(worldIds) ? [...new Set(worldIds.filter(Boolean))] : [];
  if (ids.length === 0) fail('content_world_required');
  const found = await client.contentWorld.findMany({
    where: { id: { in: ids } },
    select: { id: true, active: true, key: true },
  });
  if (found.length !== ids.length) {
    fail('unknown_content_world', 422, {
      unknown: ids.filter((i) => !found.some((f) => f.id === i)),
    });
  }
  const inactive = found.filter((f) => !f.active);
  if (inactive.length) fail('inactive_content_world', 422, { inactive: inactive.map((i) => i.key) });
  return ids;
}

/**
 * THE invariant: every chosen category must belong to one of the item's worlds.
 *
 * Without this, a GOS-only item could be filed under CHALLENGE/תזונה — the
 * category tree would still render, but the item would be reachable from a
 * world it does not belong to. Rejected with the offending pairs named, so the
 * client can explain the problem instead of failing opaquely.
 */
export async function assertCategoriesMatchWorlds(client, { categoryIds, worldIds }) {
  const ids = Array.isArray(categoryIds) ? [...new Set(categoryIds.filter(Boolean))] : [];
  if (ids.length === 0) return [];
  const cats = await client.libraryCategory.findMany({
    where: { id: { in: ids } },
    select: { id: true, nameHe: true, worldId: true, archived: true },
  });
  if (cats.length !== ids.length) {
    fail('unknown_category', 422, { unknown: ids.filter((i) => !cats.some((c) => c.id === i)) });
  }
  const allowed = new Set(worldIds);
  const foreign = cats.filter((c) => !allowed.has(c.worldId));
  if (foreign.length) {
    fail('category_world_mismatch', 422, {
      categories: foreign.map((c) => ({ id: c.id, nameHe: c.nameHe, worldId: c.worldId })),
    });
  }
  return ids;
}

/** Replace an item's world membership. */
export async function setItemWorlds(client, itemId, worldIds) {
  await client.libraryItemWorld.deleteMany({ where: { itemId } });
  if (!worldIds.length) return;
  await client.libraryItemWorld.createMany({
    data: worldIds.map((worldId) => ({ itemId, worldId })),
    skipDuplicates: true,
  });
}

/**
 * Which category links would be dropped if an item's worlds changed to
 * `nextWorldIds`. The UI warns with this BEFORE saving, so removing a world
 * never silently discards the categories filed under it.
 */
export async function categoriesLostByWorldChange(client, itemId, nextWorldIds) {
  const links = await client.libraryItemCategory.findMany({
    where: { itemId },
    include: { category: { select: { id: true, nameHe: true, worldId: true } } },
  });
  const keep = new Set(nextWorldIds);
  return links
    .filter((l) => !keep.has(l.category.worldId))
    .map((l) => ({ id: l.category.id, nameHe: l.category.nameHe, worldId: l.category.worldId }));
}

/**
 * Drop category links that no longer belong to any of the item's worlds.
 *
 * Called after a world change so the database can never hold a link that
 * violates the invariant — the alternative (leaving them) would make the
 * validation above a lie for existing rows.
 */
export async function pruneCategoriesOutsideWorlds(client, itemId, worldIds) {
  const lost = await categoriesLostByWorldChange(client, itemId, worldIds);
  if (!lost.length) return 0;
  await client.libraryItemCategory.deleteMany({
    where: { itemId, categoryId: { in: lost.map((c) => c.id) } },
  });
  return lost.length;
}
