// ── Durable list state — the ONE contract for "where the operator was" ──────
//
// The production bug this exists to kill: every admin list held its page in
// plain component state. Opening a record unmounted the list; coming back
// remounted it at page 1, scrolled to the top, with the sort reset. An
// operator working page 4 of דילים lost their place on every single record
// they opened.
//
// The fix has one rule: THE URL OWNS DURABLE LIST STATE. Page, search,
// filters, sort and view mode live in the query string, so:
//   • browser Back returns to the exact list URL (React just re-reads it),
//   • refresh reproduces the list,
//   • a pasted link reproduces what the sender saw,
//   • two tabs cannot corrupt each other (each has its own URL),
//   • one list cannot leak into another (params are scoped to a pathname).
//
// localStorage keeps a per-module "sticky" copy of the filters the operator
// last chose, so returning to a module tomorrow lands in the same workspace.
// Sticky values seed the state ONLY on a first mount whose URL carries no list
// params at all — a deep link is never contaminated by local preferences.
//
// This file is PURE (no React, no router): every rule below is unit-testable.
// The hooks live in useListState.js.

// ── Field types ─────────────────────────────────────────────────────────────
// A list declares its fields as { name: { type, default, sticky, url } }.
//   type    'string' (default) | 'int' | 'bool' | 'sort' | 'csv' | 'json'
//   default the value that is OMITTED from the URL (clean links)
//   sticky  true  → mirrored to localStorage as the module's remembered filter
//   url     false → never written to the URL (for state too large to serialise
//                   sensibly, e.g. an advanced filter tree); sticky only.

export function parseSort(raw) {
  if (typeof raw !== 'string') return null;
  const [key, dir] = raw.split(':');
  if (!key) return null;
  return { key, dir: dir === 'asc' ? 'asc' : 'desc' };
}

export function formatSort(v) {
  if (!v || !v.key) return '';
  return `${v.key}:${v.dir === 'asc' ? 'asc' : 'desc'}`;
}

const TYPES = {
  string: {
    parse: (raw) => raw,
    serialize: (v) => (v == null ? '' : String(v)),
    eq: (a, b) => String(a ?? '') === String(b ?? ''),
  },
  int: {
    parse: (raw, def) => {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n >= 1 ? n : def;
    },
    serialize: (v) => String(v),
    eq: (a, b) => Number(a) === Number(b),
  },
  bool: {
    parse: (raw) => raw === '1' || raw === 'true',
    serialize: (v) => (v ? '1' : '0'),
    eq: (a, b) => !!a === !!b,
  },
  sort: {
    parse: (raw, def) => parseSort(raw) || def,
    serialize: (v) => formatSort(v),
    eq: (a, b) => formatSort(a) === formatSort(b),
  },
  csv: {
    parse: (raw) => (raw ? raw.split(',').filter(Boolean) : []),
    serialize: (v) => (Array.isArray(v) ? v.join(',') : ''),
    eq: (a, b) =>
      (Array.isArray(a) ? a : []).join(',') === (Array.isArray(b) ? b : []).join(','),
  },
  json: {
    parse: (raw, def) => {
      try {
        const v = JSON.parse(raw);
        return v === undefined ? def : v;
      } catch {
        return def;
      }
    },
    serialize: (v) => JSON.stringify(v ?? null),
    eq: (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null),
  },
};

export function fieldType(spec) {
  return TYPES[spec?.type] || TYPES.string;
}

function getParam(params, name) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(name);
  return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : null;
}

// True when the URL already carries at least one of this list's own params.
// The hook uses it to decide whether sticky filters may seed the state: a URL
// that says anything about the list is authoritative and must reproduce
// exactly, preferences or not.
export function hasUrlState(fields, params) {
  return Object.entries(fields).some(
    ([name, spec]) => spec.url !== false && getParam(params, name) != null,
  );
}

// URL (+ optional sticky seed) → the list's state object.
// Precedence per field: URL param → sticky value → declared default.
export function decodeListState(fields, params, sticky = null) {
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    const t = fieldType(spec);
    const def = spec.default;
    const raw = spec.url === false ? null : getParam(params, name);
    if (raw != null) {
      out[name] = t.parse(raw, def);
    } else if (sticky && Object.prototype.hasOwnProperty.call(sticky, name)) {
      // Sticky values are stored already-typed; re-normalise through the type
      // so a corrupted store can never inject a shape the screen can't render.
      out[name] = t.parse(t.serialize(sticky[name]), def);
    } else {
      out[name] = def;
    }
  }
  return out;
}

// State → the next URLSearchParams. Foreign params (anything not declared by
// this list) are preserved untouched, so a list can share a route with other
// query-driven features. Default values are removed, keeping links short.
export function applyListParams(fields, current, state) {
  const next = new URLSearchParams(current || '');
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.url === false) {
      next.delete(name);
      continue;
    }
    const t = fieldType(spec);
    if (t.eq(state[name], spec.default)) next.delete(name);
    else next.set(name, t.serialize(state[name]));
  }
  return next;
}

// A patch that touches ANY field other than the page must send the operator
// back to page 1 — page 7 of a freshly narrowed result set is meaningless.
// Living here (instead of in a useEffect) is what makes restoration possible:
// an effect would fire on mount and immediately destroy the restored page.
export function nextListState(fields, state, patch, pageField = 'page') {
  const next = { ...state, ...patch };
  const keys = Object.keys(patch);
  const touchesOther = keys.some((k) => k !== pageField);
  if (touchesOther && !keys.includes(pageField) && fields[pageField]) {
    next[pageField] = fields[pageField].default;
  }
  return next;
}

export function listStateEquals(fields, a, b) {
  return Object.entries(fields).every(([name, spec]) => fieldType(spec).eq(a?.[name], b?.[name]));
}

// ── Sticky (per-module remembered filters) ──────────────────────────────────

export function stickyStorageKey(key) {
  return `gos.list.${key}.v2`;
}

export function readSticky(key, storage = defaultLocal()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(stickyStorageKey(key));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// Writes EVERY sticky field, including empty ones — "the operator cleared the
// search" is itself a preference and must survive a refresh.
export function writeSticky(key, fields, state, storage = defaultLocal()) {
  if (!storage) return;
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.sticky) out[name] = state[name];
  }
  try {
    storage.setItem(stickyStorageKey(key), JSON.stringify(out));
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal, URL still works */
  }
}

function defaultLocal() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ── Pagination helpers ──────────────────────────────────────────────────────

export function pageCountOf(total, pageSize) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : 1;
  return Math.max(1, Math.ceil((Number(total) || 0) / size));
}

// "עבור לסוף" resolves to the last page in ONE jump — no intermediate fetches.
export function clampPage(page, total, pageSize) {
  const count = pageCountOf(total, pageSize);
  const n = Number(page) || 1;
  return Math.min(Math.max(1, n), count);
}
