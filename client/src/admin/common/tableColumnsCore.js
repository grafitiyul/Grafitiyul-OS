// Pure column-state logic behind the shared table infrastructure
// (tableColumns.jsx). No React, no DOM — unit-testable with node --test.
//
// Persisted state per table: { visible: [keys], order: [keys], widths: {key: px} }.
// Legacy format (a plain array of visible keys, pre-reorder) is still read.

// ── Multi-column sort ────────────────────────────────────────────────────
// Sort state is an ORDERED list of { key, dir } — first entry is the primary
// sort. Screens that only ever sort by one column keep passing a single
// { key, dir } object to the table; this list form is opt-in.

/** Cap the sort depth. Beyond ~3 keys nobody can read the result anyway. */
export const MAX_SORT_KEYS = 3;

/**
 * Toggle a column in the sort list.
 *
 * Plain click  → this column becomes the ONLY sort (asc; clicking the active
 *                column again flips its direction).
 * Shift+click  → ADD the column to the existing sort, or flip it if already
 *                there. Dropping a shift-clicked column requires flipping it
 *                past desc, which is the same asc→desc→remove cycle the plain
 *                click does not need.
 *
 * @param {Array<{key,dir}>} sort current list
 * @param {string} key column toggled
 * @param {{additive?: boolean}} [opts]
 * @returns {Array<{key,dir}>} a NEW list
 */
export function toggleSortKey(sort, key, opts = {}) {
  const list = Array.isArray(sort) ? sort : sort ? [sort] : [];
  const idx = list.findIndex((s) => s.key === key);

  if (!opts.additive) {
    if (idx === 0 && list.length === 1) {
      return [{ key, dir: list[0].dir === 'asc' ? 'desc' : 'asc' }];
    }
    return [{ key, dir: 'asc' }];
  }

  if (idx < 0) {
    if (list.length >= MAX_SORT_KEYS) return list;
    return [...list, { key, dir: 'asc' }];
  }
  // Already in the list: asc → desc → removed.
  if (list[idx].dir === 'asc') {
    const next = [...list];
    next[idx] = { key, dir: 'desc' };
    return next;
  }
  return list.filter((s) => s.key !== key);
}

/** Serialize to the API's `sort=key:dir,key2:dir2`. */
export function sortToParam(sort) {
  const list = Array.isArray(sort) ? sort : sort ? [sort] : [];
  return list.map((s) => `${s.key}:${s.dir}`).join(',');
}

/** Parse `key:dir,key2:dir2` back into a list. Unknown keys are dropped. */
export function sortFromParam(raw, allowedKeys) {
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, dir = 'asc'] = part.split(':');
      return { key, dir: dir === 'desc' ? 'desc' : 'asc' };
    })
    .filter((s) => s.key && (!allowed || allowed.has(s.key)))
    .slice(0, MAX_SORT_KEYS);
}

// Columns may not collapse below this (a column's `minWidth` can raise it).
export const MIN_COL_WIDTH = 60;
// …nor grow past this, so one dragged column can't swallow the whole table (a
// column's `maxWidth` can lower it). Generous enough that no existing layout
// is disturbed on load — only fresh resize commits are clamped.
export const MAX_COL_WIDTH = 720;

// Normalize whatever localStorage holds into a valid { visible, order }:
// unknown keys are dropped, columns added to the app since the save are
// appended to the order and keep their `def` visibility (a v2 save's `order`
// lists every column that existed at save time, so absence = genuinely new;
// legacy saves can't tell "hidden" from "new", so their visible list wins).
export function normalizeColumnState(raw, canonicalKeys, defaultVisible) {
  const known = new Set(canonicalKeys);
  const legacy = Array.isArray(raw);
  const rawVisible = legacy
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(raw.visible)
      ? raw.visible
      : null;
  const rawOrder =
    !legacy && raw && typeof raw === 'object' && Array.isArray(raw.order) ? raw.order : null;

  let visible = (rawVisible || []).filter((k) => known.has(k));
  if (!rawVisible || !visible.length) {
    visible = [...defaultVisible];
  } else if (rawOrder) {
    const storedKeys = new Set(rawOrder);
    for (const k of defaultVisible) {
      if (!storedKeys.has(k) && !visible.includes(k)) visible.push(k);
    }
  }

  const order = (rawOrder || []).filter((k) => known.has(k));
  for (const k of canonicalKeys) if (!order.includes(k)) order.push(k);

  // Saved widths: unknown keys dropped, values clamped to the floor.
  const rawWidths =
    !legacy && raw && typeof raw === 'object' && raw.widths && typeof raw.widths === 'object'
      ? raw.widths
      : null;
  const widths = {};
  if (rawWidths) {
    for (const k of Object.keys(rawWidths)) {
      const v = Number(rawWidths[k]);
      if (known.has(k) && Number.isFinite(v)) widths[k] = Math.max(MIN_COL_WIDTH, Math.round(v));
    }
  }
  return { visible, order, widths };
}

// Commit a header-edge drag: clamp to the column's [min, max] and round to px.
export function setKeyWidth(widths, key, px, min = MIN_COL_WIDTH, max = MAX_COL_WIDTH) {
  const v = Number(px);
  if (!Number.isFinite(v)) return widths;
  const clamped = Math.min(Math.max(Math.round(v), min), Math.max(min, max));
  return { ...widths, [key]: clamped };
}

// Toggle a column's visibility. Never allows hiding the last visible column.
export function toggleVisibleKey(visible, key) {
  const has = visible.includes(key);
  if (has && visible.length === 1) return visible;
  return has ? visible.filter((k) => k !== key) : [...visible, key];
}

// Drag reorder: move `fromKey` to `toKey`'s position (dnd "dropped over").
export function moveKey(order, fromKey, toKey) {
  const from = order.indexOf(fromKey);
  const to = order.indexOf(toKey);
  if (from === -1 || to === -1 || from === to) return order;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// The columns to render, in the user's order, visibility applied.
export function orderedVisibleColumns(columns, { visible, order }) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return order.map((k) => byKey.get(k)).filter((c) => c && visible.includes(c.key));
}

// Rename a persisted column key in place (visible/order/widths) so a RENAMED
// column keeps the user's position, visibility and width instead of vanishing
// (unknown keys are dropped on load) and reappearing at the end as a default.
// Pure over the RAW stored value → returns the migrated value (or the input
// unchanged when `from` is absent or `to` already exists). Idempotent.
export function renameColumnKeyInState(raw, from, to) {
  if (!raw || from === to) return raw;
  const swapArr = (arr) =>
    Array.isArray(arr)
      ? arr.includes(to)
        ? arr.filter((k) => k !== from) // target already there → just drop old
        : arr.map((k) => (k === from ? to : k))
      : arr;
  if (Array.isArray(raw)) return swapArr(raw); // legacy array-of-visible-keys
  if (typeof raw !== 'object') return raw;
  const next = { ...raw, visible: swapArr(raw.visible), order: swapArr(raw.order) };
  if (raw.widths && typeof raw.widths === 'object' && from in raw.widths) {
    const widths = { ...raw.widths };
    if (!(to in widths)) widths[to] = widths[from];
    delete widths[from];
    next.widths = widths;
  }
  return next;
}

// localStorage wrapper for the above — reads the stored layout, renames the
// key, writes it back. No-op on parse errors / unavailable storage.
export function migrateStoredColumnKey(storageKey, from, to) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    if (raw == null) return;
    const next = renameColumnKeyInState(raw, from, to);
    if (next !== raw) localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* corrupt/unavailable — normalizeColumnState will fall back to defaults */
  }
}
