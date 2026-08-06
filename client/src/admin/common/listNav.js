// ── Returning to a list exactly where you left it ───────────────────────────
//
// Two pure concerns that pair with listState.js:
//
//   1. SCROLL — the URL restores WHICH rows are shown; it cannot restore how
//      far down them the operator had scrolled. That lives per browser tab in
//      sessionStorage, keyed by the full list URL, so a filter change (a new
//      URL) correctly starts at the top while a return to the same URL lands
//      on the same row. sessionStorage — not localStorage — is deliberate:
//      opening a record in a second tab must never move the first tab.
//
//   2. ORIGIN — where a record page should send you "back" to. A record can be
//      reached from a list, from global search, from a link in a message, or
//      by pasting a URL. Only the first case has a real return location; the
//      rest must fall back to the canonical list root. Never assume page 1 is
//      "back" when a genuine origin exists.
//
// Pure module (no React) so both rules are unit-testable. Hooks: useListState.js.

// ── Scroll store ────────────────────────────────────────────────────────────

const SCROLL_STORE_KEY = 'gos.listScroll.v1';
// Keeping the map small bounds sessionStorage growth across a long session;
// 40 distinct list URLs is far more than an operator visits between reloads.
const SCROLL_MAX_ENTRIES = 40;

export function scrollKey(pathname, search) {
  return `${pathname || ''}${search || ''}`;
}

function readStore(storage) {
  if (!storage) return {};
  try {
    const v = JSON.parse(storage.getItem(SCROLL_STORE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveScrollTop(key, top, storage = defaultSession()) {
  if (!storage || !key) return;
  const n = Number(top);
  if (!Number.isFinite(n) || n < 0) return;
  const store = readStore(storage);
  // Re-insert so the key becomes the most recent in insertion order — the
  // trim below then evicts the least recently written list.
  delete store[key];
  store[key] = Math.round(n);
  const keys = Object.keys(store);
  for (const stale of keys.slice(0, Math.max(0, keys.length - SCROLL_MAX_ENTRIES))) {
    delete store[stale];
  }
  try {
    storage.setItem(SCROLL_STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — scroll memory is a nicety, never fatal */
  }
}

export function readScrollTop(key, storage = defaultSession()) {
  if (!storage || !key) return 0;
  const v = readStore(storage)[key];
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function defaultSession() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

// The scrolling ancestor a list actually lives in. The admin shell scrolls
// `<main>`, but module layouts (CRM, People, Finance…) introduce their OWN
// overflow-y-auto wrapper — so "scroll the window" is wrong almost everywhere
// and the real container has to be discovered from the rendered tree.
export function findScrollParent(el, getStyle) {
  const styleOf =
    getStyle ||
    (typeof window !== 'undefined' && window.getComputedStyle
      ? (n) => window.getComputedStyle(n)
      : null);
  let node = el?.parentElement || null;
  while (node) {
    const overflow = styleOf ? `${styleOf(node).overflowY || ''}` : '';
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node;
    node = node.parentElement;
  }
  if (typeof document !== 'undefined') return document.scrollingElement || null;
  return null;
}

// ── Navigation origin ───────────────────────────────────────────────────────

export const LIST_RETURN_KEY = 'listReturn';

// Attached as react-router location `state` when a list opens a record.
export function makeListReturn(location) {
  if (!location?.pathname) return undefined;
  return { [LIST_RETURN_KEY]: { pathname: location.pathname, search: location.search || '' } };
}

// Required precedence: a real in-app origin wins; otherwise the canonical list
// root. `mode: 'back'` means the caller should use history back (one step), so
// the browser restores the previous entry — which is what makes scroll and any
// unserialised UI state come back too.
export function resolveListReturn(locationState, fallbackTo) {
  const origin = locationState?.[LIST_RETURN_KEY];
  const pathname = origin?.pathname;
  // Only same-origin admin paths are trusted; `state` is attacker-influencable
  // in principle (history.pushState), so never navigate somewhere arbitrary.
  if (typeof pathname === 'string' && pathname.startsWith('/admin/') && !pathname.startsWith('//')) {
    return { mode: 'back', to: `${pathname}${origin.search || ''}` };
  }
  return { mode: 'fallback', to: fallbackTo };
}
