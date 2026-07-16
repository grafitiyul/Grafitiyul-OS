// Saved Views — pure permission + validation logic (no Prisma, no I/O), unit
// tested. The route (routes/savedViews.js) is a thin caller; if a rule about
// who may see/edit a view or what a view may contain lives anywhere else, it
// is a bug.
//
// Scopes:
//   personal — visible to and editable by its owner only
//   shared   — visible to every admin, editable by its owner only
//   system   — seeded from code, visible to every admin, editable by NOBODY
//              (fixing a system view is a code change, not a UI action)

export const VIEW_SCOPES = Object.freeze(['personal', 'shared', 'system']);
export const CREATABLE_SCOPES = Object.freeze(['personal', 'shared']);
export const VIEW_MODULES = Object.freeze(['crm_tasks']);

// A view is a preference blob; cap it so nobody can turn the table into a
// document store. Generous: a real view with a full column snapshot is ~1–2KB.
export const MAX_VIEW_JSON_BYTES = 16 * 1024;

const plainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a create/update body. `partial: true` (update) validates only the
 * fields present; create requires name + scope + filters + sort.
 *
 * @returns {{ok:true, data:object} | {ok:false, error:string}}
 */
export function validateViewInput(body, { sortableKeys, partial = false } = {}) {
  const b = body || {};
  const data = {};

  if (b.name !== undefined || !partial) {
    const name = String(b.name ?? '').trim();
    if (!name) return { ok: false, error: 'name_required' };
    if (name.length > 60) return { ok: false, error: 'name_too_long' };
    data.name = name;
  }
  if (b.icon !== undefined) {
    const icon = b.icon == null ? null : String(b.icon).trim();
    if (icon && icon.length > 8) return { ok: false, error: 'icon_too_long' };
    data.icon = icon || null;
  }
  if (b.scope !== undefined || !partial) {
    // 'system' is never creatable or settable through the API.
    if (!CREATABLE_SCOPES.includes(b.scope)) return { ok: false, error: 'invalid_scope' };
    data.scope = b.scope;
  }
  if (b.filters !== undefined || !partial) {
    if (!plainObject(b.filters)) return { ok: false, error: 'filters_required' };
    data.filters = b.filters;
  }
  if (b.sort !== undefined || !partial) {
    if (!Array.isArray(b.sort)) return { ok: false, error: 'sort_required' };
    const allowed = new Set(sortableKeys || []);
    const sort = b.sort
      .filter((s) => plainObject(s) && allowed.has(s.key))
      .map((s) => ({ key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' }))
      .slice(0, 3);
    data.sort = sort;
  }
  if (b.columns !== undefined) {
    if (b.columns !== null && !plainObject(b.columns)) return { ok: false, error: 'invalid_columns' };
    data.columns = b.columns;
  }

  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > MAX_VIEW_JSON_BYTES) return { ok: false, error: 'view_too_large' };

  return { ok: true, data };
}

/** May this user edit/delete this view? System views: never, for anyone. */
export function canEditView(view, userId) {
  if (!view || !userId) return false;
  if (view.scope === 'system') return false;
  return view.ownerUserId === userId;
}

/** The Prisma `where` for "every view this user may see" in a module. */
export function viewsWhere(module, userId) {
  return {
    module,
    OR: [
      { scope: 'system' },
      { scope: 'shared' },
      { scope: 'personal', ownerUserId: userId },
    ],
  };
}

/**
 * Display order: system first (their seeded order), then shared, then personal,
 * alphabetically within each group — stable and predictable, not recency-churned.
 */
export function sortViews(views) {
  const rank = { system: 0, shared: 1, personal: 2 };
  return [...views].sort(
    (a, b) =>
      (rank[a.scope] ?? 9) - (rank[b.scope] ?? 9) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      String(a.name).localeCompare(String(b.name), 'he'),
  );
}
