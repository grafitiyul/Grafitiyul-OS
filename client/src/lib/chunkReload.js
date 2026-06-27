// One-time, guarded full reload when a dynamic import / chunk fetch fails.
//
// Why this exists: assets are content-hashed + immutable. After a deploy, an
// old tab still references the PREVIOUS chunk hashes — which no longer exist on
// the server. The moment GOS introduces code-splitting (React.lazy / dynamic
// import), navigating in a stale tab would throw a ChunkLoadError and dead-end
// the screen. A single, deliberate reload pulls the tab onto the fresh build.
//
// Today the app is a single bundle, so this is effectively a no-op safety net —
// but it must be in place BEFORE code-splitting lands, not bolted on after.
//
// Loop protection: we record the last reload time in sessionStorage and refuse
// to reload again within a short window, so a genuinely persistent failure can
// never become an infinite reload loop. A later deploy (minutes/hours later) can
// still trigger a fresh reload.

const KEY = 'gos.chunkReloadAt';
const MIN_GAP_MS = 10000;

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < MIN_GAP_MS) return; // reloaded just now → avoid a loop
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked — still attempt a single reload below */
  }
  window.location.reload();
}

function isChunkError(input) {
  if (!input) return false;
  const msg = typeof input === 'string' ? input : input.message || '';
  return /ChunkLoadError|Loading chunk [\w-]+ failed|dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(
    msg,
  );
}

let installed = false;

export function installChunkReload() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Vite's first-class signal for a failed lazy/preload import (preferred path).
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault?.();
    reloadOnce();
  });
  // Generic runtime errors (covers non-Vite bundlers / direct import() too).
  window.addEventListener('error', (e) => {
    if (isChunkError(e?.message) || isChunkError(e?.error)) reloadOnce();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkError(e?.reason)) reloadOnce();
  });
}
