import { useEffect, useRef } from 'react';
import { todayIL, msUntilNextIsraelMidnight } from './calendar/dates.js';

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

// Pure Israel-midnight refresh scheduler (no React, no DOM) — the testable core
// behind useTourMidnightRefresh. Arms a timer for the next IL midnight; on fire
// it calls `emit` and re-arms for the following midnight. checkDayChange() is
// the visibility/focus recovery: if the IL date rolled over since the last
// refresh (e.g. the tab slept through midnight and the timer fired late or not
// at all), it emits immediately and realigns the timer. Clock/timer deps are
// injectable so the whole thing is deterministic under test.
export function startMidnightRefresh(
  emit,
  {
    now = () => new Date(),
    today = todayIL,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  let timer;
  let lastDate = today();
  const fire = () => {
    lastDate = today();
    emit();
  };
  const schedule = () => {
    clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      fire();
      schedule(); // arm the following midnight
    }, msUntilNextIsraelMidnight(now()));
    // In Node (tests) a pending timer is a REF'd handle that would keep the
    // process alive; unref lets it exit. No-op in the browser (numeric id).
    timer?.unref?.();
  };
  schedule();
  return {
    // Call on tab visible/focus — refreshes only if the day actually changed.
    checkDayChange: () => {
      if (today() !== lastDate) {
        fire();
        schedule();
      }
    },
    stop: () => clearTimeoutFn(timer),
  };
}

// THE single midnight-refresh timer for the whole Tours module. Mount it ONCE
// at the module root (ToursPage); at each Asia/Jerusalem midnight it emits the
// canonical tour-changed signal, so the table, calendar and any open Tour
// drawer all re-fetch through the ONE mechanism — picking up the server-side
// automatic completion that flips tours at IL midnight. No page reload, no
// spinner, no per-surface timer. On tab visibility/focus it also recovers when
// the day rolled over while the tab was hidden or asleep.
export function useTourMidnightRefresh() {
  useEffect(() => {
    const ctrl = startMidnightRefresh(() => emitTourChanged({ reason: 'midnight' }));
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      ctrl.checkDayChange();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onVisible);
    }
    return () => {
      ctrl.stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onVisible);
      }
    };
  }, []);
}
