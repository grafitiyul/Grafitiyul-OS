// ── Surviving a page refresh with the record drawer still open ───────────────
//
// The drawer is pinned to a RECORD (drawerNav.js). That anchor lived only in
// React state, so a browser refresh — the one thing an operator does without
// thinking — dropped it: the Tasks screen came back with the queue restored
// from the URL and nothing open, and the operator had to find their deal again.
//
// The anchor is UI navigation state, exactly like the filters and the sort next
// to it, so it belongs where they already live: the URL. That also makes the
// address bar honest — a shared link opens the same deal the sender was looking
// at, not just the same list.
//
// ONLY IDS travel. No customer data, no row snapshot, no titles — the ids are
// re-resolved against the freshly loaded list, so a stale link can never render
// stale content.
//
// Pure module (no React, no DOM) so every rule below is unit-testable.

export const DRAWER_DEAL_PARAM = 'deal';
export const DRAWER_TASK_PARAM = 'task';

// The anchor → the two params the URL carries. A closed drawer contributes
// nothing, so closing it genuinely clears the state rather than leaving a
// pointer behind.
export function drawerParams(anchor) {
  if (!anchor?.recordId) return {};
  const out = { [DRAWER_DEAL_PARAM]: anchor.recordId };
  // The ROW (the task) is what the operator was working on; it is what lets the
  // restore land on the same task rather than merely the same deal.
  if (anchor.rowId) out[DRAWER_TASK_PARAM] = anchor.rowId;
  return out;
}

// Copy the drawer params onto a freshly built param set. The workspace rebuilds
// its URL from the filters on every change and REPLACES the query string; without
// this the drawer's own params would be wiped a tick after they were written.
export function withDrawerParams(params, anchor) {
  const next = new URLSearchParams(params);
  next.delete(DRAWER_DEAL_PARAM);
  next.delete(DRAWER_TASK_PARAM);
  for (const [k, v] of Object.entries(drawerParams(anchor))) next.set(k, v);
  return next;
}

// What a page load found in the URL. Returns null when no drawer was open.
export function readDrawerParams(searchParams) {
  const recordId = searchParams.get(DRAWER_DEAL_PARAM);
  if (!recordId) return null;
  return { recordId, rowId: searchParams.get(DRAWER_TASK_PARAM) || null };
}

// Turn what the URL remembered into a live anchor, against the rows that just
// loaded.
//
// The honest-state rule: when the remembered ROW is no longer in the list — it
// was completed, or the restored filter simply does not include it — the DEAL
// STAYS OPEN, `detached`, at the position the list can still justify. It must
// never fall through to "some other deal at that index", which is precisely the
// teleporting bug drawerNav.js exists to prevent. `detached` is already the
// vocabulary for "the record is open but no longer in the filtered list", and
// the drawer already renders it truthfully ("— מתוך N").
//
// Returns null only when the URL carried no drawer at all.
export function restoreAnchor(restore, rows, keys) {
  if (!restore?.recordId) return null;
  const list = rows || [];
  const rowIdOf = keys?.rowIdOf || ((r) => r?.id ?? null);
  const recordIdOf = keys?.recordIdOf || ((r) => r?.deal?.id ?? null);

  // 1. The exact task is still on screen — land on it.
  if (restore.rowId) {
    const byRow = list.findIndex((r) => rowIdOf(r) === restore.rowId);
    if (byRow >= 0) {
      return { recordId: recordIdOf(list[byRow]), rowId: restore.rowId, idx: byRow, detached: false };
    }
  }
  // 2. The task is gone but the deal still has another row here (a deal with
  //    two open tasks) — anchor onto it, so Prev/Next stay meaningful.
  const byRecord = list.findIndex((r) => recordIdOf(r) === restore.recordId);
  if (byRecord >= 0) {
    return { recordId: restore.recordId, rowId: rowIdOf(list[byRecord]), idx: byRecord, detached: false };
  }
  // 3. Neither is in the list. Keep the deal open and say so.
  return { recordId: restore.recordId, rowId: restore.rowId, idx: 0, detached: true };
}
