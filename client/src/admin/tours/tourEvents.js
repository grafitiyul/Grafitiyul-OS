import { useEffect, useRef } from 'react';

// THE canonical "a TourEvent changed" client signal. Any mutation that alters
// a tour's operational state (today: the Deal's "עדכון סיור" orchestration)
// emits it; every mounted Tours surface (table, calendar range, open Tour
// modal) listens and SILENTLY re-fetches — no manual browser refresh, no
// per-component ad-hoc wiring, no polling. Mirrors the existing event-bus
// convention (deals/tasks/taskEvents.js, whatsapp/composerEvents.js).
//
// Same-tab delivery is a window CustomEvent. Cross-tab (Deal open in one tab,
// Tours in another) rides a BroadcastChannel when available; a listener that
// re-fetches the whole visible range/list is self-correcting for date MOVES —
// the moved tour simply leaves the old range and joins the new one, because
// each consumer re-queries rather than patching a single row.
//
// detail: { tourEventId?, dealId? } — carried for future targeted use; today's
// consumers re-fetch their range/list wholesale, so the payload is advisory.

export const TOUR_CHANGED_EVENT = 'gos:tour-changed';
const CHANNEL_NAME = 'gos:tours';

let channel;
function getChannel() {
  if (channel === undefined) {
    channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    // Node also exposes BroadcastChannel globally, where it is a REF'd handle
    // that would keep a test process (or any Node runtime) alive forever.
    // unref() lets Node exit; in the browser the method is absent, so optional
    // chaining makes this a no-op and cross-tab delivery is unchanged.
    channel?.unref?.();
  }
  return channel;
}

export function emitTourChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOUR_CHANGED_EVENT, { detail }));
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: TOUR_CHANGED_EVENT, detail });
    } catch {
      /* channel closed — same-tab delivery already happened */
    }
  }
}

// Subscribe to tour-changed from THIS tab and (when supported) other tabs.
// Returns an unsubscribe function; safe no-op outside a browser.
export function onTourChanged(handler) {
  if (typeof window === 'undefined') return () => {};
  const onWin = (e) => handler(e.detail || {});
  window.addEventListener(TOUR_CHANGED_EVENT, onWin);
  const ch = getChannel();
  const onMsg = (e) => {
    if (e?.data?.type === TOUR_CHANGED_EVENT) handler(e.data.detail || {});
  };
  if (ch) ch.addEventListener('message', onMsg);
  return () => {
    window.removeEventListener(TOUR_CHANGED_EVENT, onWin);
    if (ch) ch.removeEventListener('message', onMsg);
  };
}

// React convenience: run `handler(detail)` whenever a tour changes. The latest
// handler is always used (ref) so callers needn't memoize it, and the
// subscription is set up once.
export function useTourChanged(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onTourChanged((detail) => ref.current?.(detail)), []);
}
