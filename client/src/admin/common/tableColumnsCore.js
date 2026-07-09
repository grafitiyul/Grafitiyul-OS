// Pure column-state logic behind the shared table infrastructure
// (tableColumns.jsx). No React, no DOM — unit-testable with node --test.
//
// Persisted state per table: { visible: [keys], order: [keys], widths: {key: px} }.
// Legacy format (a plain array of visible keys, pre-reorder) is still read.

// Columns may not collapse below this (a column's `minWidth` can raise it).
export const MIN_COL_WIDTH = 60;

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

// Commit a header-edge drag: clamp to the column's minimum and round to px.
export function setKeyWidth(widths, key, px, min = MIN_COL_WIDTH) {
  const v = Number(px);
  if (!Number.isFinite(v)) return widths;
  return { ...widths, [key]: Math.max(min, Math.round(v)) };
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
