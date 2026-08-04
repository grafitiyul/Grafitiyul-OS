// THE canonical GOS toast channel.
//
// The codebase had no global toast infrastructure ("no global toast infra yet"
// appears twice), so success feedback fell back to native alert() — which
// blocks the screen and looks nothing like the product. This is a tiny
// module-level emitter (the same shape as the existing gos:* event seams), so
// any module can raise a toast without prop-drilling or a context provider.
//
// Mount <ToastHost /> ONCE in the app shell; call showToast/showErrorToast
// from anywhere.

const listeners = new Set();
let nextId = 1;

export const TOAST_DEFAULT_MS = 7000;

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(toast) {
  const full = { id: nextId++, tone: 'success', durationMs: TOAST_DEFAULT_MS, ...toast };
  for (const fn of listeners) {
    try {
      fn(full);
    } catch {
      /* a broken listener must never break the caller's flow */
    }
  }
  return full.id;
}

/** Green success toast. `detail` renders as a quieter second line. */
export function showToast(title, detail = null, opts = {}) {
  return emit({ tone: 'success', title, detail, ...opts });
}

/** Red error toast — same channel, so errors never fall back to alert(). */
export function showErrorToast(title, detail = null, opts = {}) {
  return emit({ tone: 'error', title, detail, ...opts });
}
