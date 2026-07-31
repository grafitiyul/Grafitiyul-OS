// Pure validation for the main-navigation configuration. No Prisma, no HTTP —
// routes/nav.js is the thin caller (project convention, same shape as
// views/savedViewsCore.js).
//
// The server deliberately does NOT know the module registry: modules are a
// CLIENT code artifact (route + component + icon), and duplicating the list here
// would create a second source of truth that silently drifts. Keys are therefore
// stored opaquely; the client resolver ignores any key it no longer recognises,
// which is what makes deleting a module from code safe with rows still in the
// table.

export const RAIL_GROUPS = ['primary', 'utility'];

// A registry key: short, lowercase, kebab-case. Bounded so the table cannot be
// used as arbitrary storage.
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validateNavConfig(body) {
  const modules = body?.modules;
  if (!Array.isArray(modules)) return { ok: false, error: 'modules_required' };
  if (modules.length > 100) return { ok: false, error: 'too_many_modules' };

  const seen = new Set();
  const rows = [];
  for (const m of modules) {
    const key = typeof m?.key === 'string' ? m.key.trim() : '';
    if (!KEY_RE.test(key)) return { ok: false, error: 'invalid_key' };
    if (seen.has(key)) return { ok: false, error: 'duplicate_key' };
    seen.add(key);

    if (typeof m.inNav !== 'boolean') return { ok: false, error: 'invalid_in_nav' };
    if (m.railGroup != null && !RAIL_GROUPS.includes(m.railGroup)) {
      return { ok: false, error: 'invalid_rail_group' };
    }
    if (!Number.isInteger(m.sortOrder) || m.sortOrder < 0 || m.sortOrder > 10000) {
      return { ok: false, error: 'invalid_sort_order' };
    }
    rows.push({
      key,
      inNav: m.inNav,
      railGroup: m.railGroup ?? null,
      sortOrder: m.sortOrder,
    });
  }
  return { ok: true, rows };
}

// The wire shape read back by the shell. Sorted so the client receives a stable
// order even before it applies its own resolver.
export function toClient(rows) {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((r) => ({
      key: r.key,
      inNav: r.inNav,
      railGroup: r.railGroup,
      sortOrder: r.sortOrder,
    }));
}
