// Frontend version channel — the mechanism that lets an already-open tab learn
// that a NEW frontend has been deployed, without a service worker and without
// any change to the (correct) cache headers.
//
// How it works:
//   • The build bakes a BUILD_ID into the bundle (see vite.config.js `define`).
//   • The server serves the deployed build's id at /version.json (no-store).
//   • This module periodically fetches /version.json and compares it to the
//     BUILD_ID this tab is running. A mismatch ⇒ a newer frontend is live.
//
// It is deliberately framework-agnostic (plain JS + a tiny subscribe API) so any
// GOS surface — admin, portal, learner, future modules — can consume it. The
// React binding lives in shell/VersionGate.jsx.

import { hasDirtyForms } from './dirtyForms.js';

// Compile-time constants injected by Vite. The `typeof` guard keeps this safe in
// any context where `define` didn't run (e.g. a unit test importing the module).
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const BUILT_AT = typeof __BUILT_AT__ !== 'undefined' ? __BUILT_AT__ : null;

let latest = BUILD_ID; // most recent deployed id we've observed
let updatePending = false; // true once a newer build is live
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a listener throwing must not break the others */
    }
  }
}

// Current snapshot. `updatePending` is the only field UIs usually need.
export function getVersionState() {
  return { buildId: BUILD_ID, latest, updatePending };
}

// Subscribe to state changes; returns an unsubscribe fn.
export function subscribeVersion(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// One liveness probe. Tiny, no-store, best-effort: any network/parse error is
// swallowed (offline, mid-deploy, dev server with no endpoint — all non-fatal).
async function check() {
  try {
    const res = await fetch('/version.json', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return;
    const data = await res.json();
    const commit = data && data.commit;
    if (commit && commit !== BUILD_ID) {
      latest = commit;
      if (!updatePending) {
        updatePending = true;
        emit();
      }
    }
  } catch {
    /* non-fatal — try again on the next tick */
  }
}

let started = false;

// Start watching for new deployments. Polls on an interval, and opportunistically
// when the tab becomes visible again (covers a laptop opened after a deploy).
// Once an update is detected we stop polling — nothing more to learn.
export function startVersionWatch({ intervalMs = 60000 } = {}) {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Debug visibility hook (see also: document.documentElement.dataset.build).
  window.__GOS_BUILD__ = { commit: BUILD_ID, builtAt: BUILT_AT };
  try {
    document.documentElement.dataset.build = BUILD_ID;
  } catch {
    /* dataset unavailable — non-fatal */
  }
  // eslint-disable-next-line no-console
  console.info('[GOS] build', BUILD_ID, BUILT_AT || '');

  check();
  setInterval(() => {
    if (!updatePending) check();
  }, intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !updatePending) check();
  });
}

// Whether it's safe to reload right now: never while a form has unsaved changes
// (opt-in registry) or while the user is actively in an input/textarea/select or
// a contentEditable surface.
export function safeToReload() {
  // Imported lazily-style to avoid a hard cycle; dirtyForms has no deps on this.
  if (hasDirtyForms()) return false;
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
      return false;
    }
  }
  return true;
}
