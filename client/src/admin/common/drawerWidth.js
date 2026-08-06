// ── How wide the record drawer is ────────────────────────────────────────────
//
// The drawer is an absolute overlay pinned to the far edge of its pane, so its
// width is expressed as its inline-START offset: the px strip of the underlying
// queue that stays visible beside it (DealDrawer's `startOffset`). Bigger
// offset = narrower drawer = more queue.
//
// The offset used to be measured from the rendered header cells and nothing
// else — a sensible default, but not a decision the operator could make. Now
// the measurement is only the DEFAULT: once the operator drags the edge, their
// number wins and is remembered on this device.
//
// Both bounds are real product rules, not padding:
//   • the drawer may never cover the whole queue — the point of this drawer is
//     that the list stays usable behind it;
//   • the drawer may never be squeezed to a sliver — it hosts a full Deal
//     workspace and has to stay workable.
//
// Pure module (no React) so the clamping is unit-testable.

// Enough queue to still read a row and click the next one.
export const MIN_LIST_STRIP_PX = 160;
// The drawer keeps at least this share of the pane.
export const MAX_START_RATIO = 0.6;
// …and at least this many px, for narrow laptops where 40% is not enough.
export const MIN_DRAWER_PX = 480;

// The widest the START offset may be, i.e. the narrowest the drawer may get.
// On a pane too small to honour MIN_DRAWER_PX the ratio wins, so the bound
// always stays above MIN_LIST_STRIP_PX and the range never inverts.
export function maxDrawerStart(containerWidth) {
  const w = Number(containerWidth) || 0;
  if (w <= 0) return 0;
  const byRatio = Math.floor(w * MAX_START_RATIO);
  const byPixels = w - MIN_DRAWER_PX;
  return Math.max(MIN_LIST_STRIP_PX, Math.min(byRatio, Math.max(byPixels, 0)) || byRatio);
}

// Clamp a proposed offset into the usable range for this pane width.
export function clampDrawerStart(px, containerWidth) {
  const w = Number(containerWidth) || 0;
  if (w <= 0) return 0;
  const max = maxDrawerStart(w);
  const value = Number(px);
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, MIN_LIST_STRIP_PX), max));
}

// ── per-operator memory (this device) ───────────────────────────────────────
// A width is a workstation preference — a 27" desk and a 13" laptop want
// different numbers — so it stays local rather than riding the account.

export function readStoredDrawerStart(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null; // storage blocked — fall back to the measured default
  }
}

export function writeStoredDrawerStart(key, px) {
  try {
    if (!Number.isFinite(px) || px <= 0) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(px)));
  } catch {
    /* storage blocked — the width simply does not persist */
  }
}
