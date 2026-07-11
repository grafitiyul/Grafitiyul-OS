// Tour completion sweep — turns "midnight passed after the tour date" into
// the explicit Completed business state (tours/completion.js is the ONE
// transition; this worker is only trigger #2). Same conventions as the other
// in-process workers: interval tick, idempotent body, never throws out.

import { sweepOverdueTours } from './completion.js';

const TICK_MS = 5 * 60 * 1000;

export function startTourCompletionWorker(log = console) {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow sweep never overlaps itself
    running = true;
    try {
      const { completed } = await sweepOverdueTours();
      if (completed > 0) log.log(`[tour-completion] completed ${completed} overdue tour(s)`);
    } catch (e) {
      log.warn('[tour-completion] sweep failed:', e.message);
    } finally {
      running = false;
    }
  };
  tick();
  const t = setInterval(tick, TICK_MS);
  t.unref?.();
  return () => clearInterval(t);
}
