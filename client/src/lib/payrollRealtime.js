// Payroll real-time client — the ONE listener implementation for both
// surfaces (Guide Portal Pay page + Admin Finance payroll screens).
//
// Contract with the server (payroll/events.js):
//   • the SSE stream carries INVALIDATION HINTS only — on any event the
//     surface silently refetches its canonical REST DTOs
//   • bursts are debounced client-side: three quick admin edits produce ONE
//     consolidated refetch, not three
//   • recovery: native EventSource retry handles transient drops; a fatally
//     closed stream (laptop sleep, mobile suspension, auth loss) is reopened
//     on focus/visibility, which ALSO triggers an immediate catch-up refetch
//     — events missed while suspended are never lost truth, only a stale view
//
// Core is framework-free and dependency-injected (testable under node:test);
// the React hook below is a thin lifecycle wrapper.

import { useEffect, useRef } from 'react';

export const DEFAULT_DEBOUNCE_MS = 400;
const REOPEN_BASE_MS = 5_000;
const REOPEN_MAX_MS = 60_000;

export function createPayrollRealtime({
  url,
  onInvalidate,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  makeEventSource = (u) => new EventSource(u),
  windowRef = typeof window !== 'undefined' ? window : null,
}) {
  let es = null;
  let debounceTimer = null;
  let reopenTimer = null;
  let reopenDelay = REOPEN_BASE_MS;
  let stopped = false;

  const invalidate = (cause) => {
    try {
      onInvalidate(cause);
    } catch {
      // A consumer error must never kill the stream.
    }
  };

  const scheduleInvalidate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      invalidate('event');
    }, debounceMs);
  };

  const open = () => {
    if (stopped || es) return;
    es = makeEventSource(url);
    es.onmessage = (msg) => {
      // Hints only — payload content is irrelevant beyond being an event.
      if (msg && typeof msg.data === 'string' && msg.data) scheduleInvalidate();
    };
    es.onopen = () => {
      reopenDelay = REOPEN_BASE_MS; // healthy again — reset the backoff
    };
    es.onerror = () => {
      // readyState CONNECTING(0) = native retry in progress — leave it alone.
      // CLOSED(2) = the browser gave up (non-200, network fatality): reopen
      // ourselves with capped backoff.
      if (es && es.readyState === 2) {
        cleanupSource();
        if (!stopped && !reopenTimer) {
          reopenTimer = setTimeout(() => {
            reopenTimer = null;
            open();
          }, reopenDelay);
          reopenDelay = Math.min(reopenDelay * 2, REOPEN_MAX_MS);
        }
      }
    };
  };

  const cleanupSource = () => {
    if (!es) return;
    try {
      es.close();
    } catch {
      /* already dead */
    }
    es = null;
  };

  // Focus / visibility = the catch-up moment after sleep or suspension:
  // refetch immediately (bypasses the debounce — this is recovery, not a
  // burst) and make sure the stream is alive again.
  const onWake = () => {
    if (stopped) return;
    if (windowRef?.document && windowRef.document.visibilityState === 'hidden') return;
    if (!es) {
      if (reopenTimer) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
      open();
    }
    invalidate('focus');
  };

  const start = () => {
    stopped = false;
    open();
    if (windowRef) {
      windowRef.addEventListener('focus', onWake);
      windowRef.document?.addEventListener('visibilitychange', onWake);
    }
  };

  const stop = () => {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (reopenTimer) clearTimeout(reopenTimer);
    debounceTimer = null;
    reopenTimer = null;
    cleanupSource();
    if (windowRef) {
      windowRef.removeEventListener('focus', onWake);
      windowRef.document?.removeEventListener('visibilitychange', onWake);
    }
  };

  return { start, stop, isOpen: () => es != null };
}

// React wrapper — ONE stream per mounted surface (Pay page / Finance module),
// never per row or card. `url` may be null/undefined to disable (e.g. the
// portal's forbidden state). onInvalidate always sees the latest closure via
// a ref, so filters/months/drawer state never force a resubscribe.
export function usePayrollRealtime(url, onInvalidate) {
  const cbRef = useRef(onInvalidate);
  cbRef.current = onInvalidate;
  useEffect(() => {
    if (!url) return undefined;
    const rt = createPayrollRealtime({ url, onInvalidate: (cause) => cbRef.current?.(cause) });
    rt.start();
    return rt.stop;
  }, [url]);
}
