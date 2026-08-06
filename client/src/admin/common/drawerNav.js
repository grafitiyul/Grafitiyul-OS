// ── Record-drawer navigation — the drawer is pinned to a RECORD, never to a
//    row index ────────────────────────────────────────────────────────────────
//
// The production bug this exists to kill: the CRM Tasks drawer WAS a row index
// into the current filtered list. Completing the open task removed its row,
// every later row shifted up, and index N silently became a DIFFERENT deal — so
// marking a task done teleported the operator onto somebody else's deal, or
// closed the drawer when the list got shorter.
//
// Completing a task is not the same as finishing the deal. The rule:
//
//   THE OPEN RECORD CHANGES ONLY BY AN EXPLICIT OPERATOR ACTION
//   (open a row, press Prev/Next, close the drawer). A list refresh —
//   for any reason: a completion, a realtime event, a filter change —
//   never moves it and never closes it.
//
// So the list refreshes truthfully while the drawer stays put. That is achieved
// by holding a small anchor:
//
//   recordId  the pinned record (the Deal). The ONLY thing that decides what is
//             rendered. Changes on open/prev/next; never on a refetch.
//   rowId     the row the drawer was opened from — used to re-find the anchor
//             after the list re-sorts or re-filters.
//   idx       the navigation anchor into the CURRENT rows.
//   detached  the pinned row is no longer in the filtered list. This is the
//             NORMAL outcome of completing it under a "פתוחות" filter, not an
//             error. `idx` then means the INSERTION POINT the row used to
//             occupy: rows[idx - 1] is still its previous neighbour and
//             rows[idx] its next one — so Prev/Next continue from the correct
//             neighbouring records instead of restarting at the top.
//
// Pure module (no React, no DOM) so every rule below is unit-testable.

// How a row exposes its own id and the record it points at. Defaults match the
// CRM task rows ({ id, deal: { id } }); any other queue can pass its own.
const DEFAULT_KEYS = {
  rowIdOf: (r) => r?.id ?? null,
  recordIdOf: (r) => r?.deal?.id ?? null,
};

// ── opening ─────────────────────────────────────────────────────────────────

export function anchorAt(rows, idx, keys = DEFAULT_KEYS) {
  const row = (rows || [])[idx];
  const recordId = keys.recordIdOf(row);
  if (!recordId) return null; // a row with no deal opens nothing
  return { recordId, rowId: keys.rowIdOf(row), idx, detached: false };
}

// ── surviving a refresh ─────────────────────────────────────────────────────

// Returns the SAME object reference when nothing changed, so callers can do
// `setDrawer((d) => reconcileAnchor(d, rows))` without risking a render loop.
export function reconcileAnchor(anchor, rows, keys = DEFAULT_KEYS) {
  if (!anchor) return anchor;
  const list = rows || [];

  // 1. The exact row survived — possibly at a new index after a re-sort.
  const byRow = list.findIndex((r) => keys.rowIdOf(r) === anchor.rowId);
  if (byRow >= 0) return patch(anchor, { idx: byRow, detached: false });

  // 2. That row is gone, but the record still has another row in the list
  //    (a deal with two open tasks: complete one, the other holds the place).
  //    Re-anchor onto it so the position indicator stays truthful.
  const byRecord = list.findIndex((r) => keys.recordIdOf(r) === anchor.recordId);
  if (byRecord >= 0) {
    return patch(anchor, { idx: byRecord, rowId: keys.rowIdOf(list[byRecord]), detached: false });
  }

  // 3. Gone from the filtered list entirely. The record STAYS OPEN; the anchor
  //    freezes at the position it held, clamped because the list also shrank.
  return patch(anchor, { idx: Math.min(anchor.idx, list.length), detached: true });
}

function patch(anchor, next) {
  for (const k of Object.keys(next)) {
    if (anchor[k] !== next[k]) return { ...anchor, ...next };
  }
  return anchor;
}

// ── walking the queue ───────────────────────────────────────────────────────

// The row index Prev/Next would land on, or null when that direction is at the
// true beginning/end of the CURRENT filtered list.
export function stepTargetIndex(anchor, rows, delta) {
  if (!anchor || !delta) return null;
  const list = rows || [];
  if (!list.length) return null;
  // Detached: `idx` is the GAP the row left behind, so the record that closed
  // the gap already sits AT idx. Forward therefore starts one step earlier than
  // it would from a real position — otherwise Next skips a record and Prev
  // repeats the one just seen.
  const target = anchor.detached && delta > 0 ? anchor.idx + delta - 1 : anchor.idx + delta;
  if (target < 0 || target >= list.length) return null;
  return target;
}

export function canStep(anchor, rows, delta) {
  return stepTargetIndex(anchor, rows, delta) !== null;
}

// Returns the anchor unchanged when the step is not possible — the drawer never
// closes or jumps as a side effect of a refused navigation.
export function stepAnchor(anchor, rows, delta, keys = DEFAULT_KEYS) {
  const target = stepTargetIndex(anchor, rows, delta);
  if (target == null) return anchor;
  return anchorAt(rows, target, keys) || anchor;
}

// ── the position indicator ──────────────────────────────────────────────────

export function drawerPosition(anchor, rows) {
  const total = (rows || []).length;
  if (!anchor || anchor.detached) return { index: null, total };
  return { index: anchor.idx + 1, total };
}

// Hebrew wording, deliberately NOT a slash: "115 / 102" is ambiguous in RTL —
// the reader cannot tell which side is the position. "102 מתוך 115" cannot be
// misread. A detached record has no honest number, so it shows none rather
// than pointing at a row that is not it.
export function formatDrawerPosition(position) {
  if (!position || typeof position !== 'object') return null;
  const total = Number(position.total) || 0;
  if (position.index == null) return `— מתוך ${total}`;
  return `${position.index} מתוך ${total}`;
}

// ── keyboard + physical direction ───────────────────────────────────────────
//
// The control renders dir="ltr" so this order is what the operator physically
// sees, left → right, in RTL and LTR alike. Owner decision, and the reason the
// old control felt reversed:
//
//   LEFT arrow  = הקודם (previous item in the current ordered list)
//   RIGHT arrow = הבא   (next item)
//
export const NAV_ORDER = ['prev', 'next'];

// e.key is the PHYSICAL arrow key — never mirrored by RTL — so Alt+← maps to
// the button on the left, which is exactly what the operator pressed toward.
const ALT_KEYS = {
  ArrowLeft: 'prev',
  ArrowUp: 'prev',
  ArrowRight: 'next',
  ArrowDown: 'next',
};

export function navActionForKey(e) {
  if (!e || !e.key) return null;
  if (e.key === 'PageUp') return 'prev';
  if (e.key === 'PageDown') return 'next';
  if (!e.altKey) return null;
  return ALT_KEYS[e.key] || null;
}
