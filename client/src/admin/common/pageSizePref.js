// Pure logic for the shared "rows per page" preference used by the CRM list
// screens (Deals / Contacts / Organizations). Kept framework-free so it can be
// unit-tested without a DOM. The React glue (a <select> + a persistence hook)
// lives in PageSizeSelector.jsx.
//
// The server accepts exactly these page sizes (default 50, max 200); anything
// else is clamped to the nearest ALLOWED value so a stale/hand-edited
// localStorage value can never send an out-of-contract pageSize.
export const PAGE_SIZES = [20, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;

// Snap an arbitrary number to the closest allowed page size. Non-numeric or
// missing input falls back to `fallback` (itself clamped, so the default is
// always safe).
export function clampPageSize(value, fallback = DEFAULT_PAGE_SIZE) {
  // Treat missing/blank as "no choice" — Number(null) is 0 (finite), which
  // must NOT be read as a real size.
  if (value == null || value === '') return coerceFallback(fallback);
  const n = Number(value);
  if (!Number.isFinite(n)) return coerceFallback(fallback);
  if (PAGE_SIZES.includes(n)) return n;
  // Nearest allowed size (ties resolve to the smaller — cheaper — option).
  let best = PAGE_SIZES[0];
  let bestDist = Math.abs(n - best);
  for (const size of PAGE_SIZES) {
    const dist = Math.abs(n - size);
    if (dist < bestDist) {
      best = size;
      bestDist = dist;
    }
  }
  return best;
}

function coerceFallback(fallback) {
  const f = Number(fallback);
  return PAGE_SIZES.includes(f) ? f : DEFAULT_PAGE_SIZE;
}

// Read the persisted page size for a storage key, clamped to the allowed set.
// Any failure (no storage, bad JSON, unknown value) yields the default.
export function loadPageSize(storage, storageKey, fallback = DEFAULT_PAGE_SIZE) {
  try {
    const raw = storage?.getItem(storageKey);
    if (raw == null || raw === '') return coerceFallback(fallback);
    return clampPageSize(raw, fallback);
  } catch {
    return coerceFallback(fallback);
  }
}

// Persist a page size (clamped first). Returns the value actually stored so
// callers can keep state and storage in lockstep. Storage failures are
// swallowed (private mode / quota) — the choice just won't persist.
export function savePageSize(storage, storageKey, value) {
  const clamped = clampPageSize(value);
  try {
    storage?.setItem(storageKey, String(clamped));
  } catch {
    /* storage unavailable — non-fatal */
  }
  return clamped;
}
