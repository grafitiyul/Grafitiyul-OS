// Midnight (Israel) missing-task recovery worker. Same conventions as the
// other tick workers: setInterval + reentrancy guard + unref.
//
// Scheduling contract: on every tick it asks "have I already swept TODAY's
// Israel calendar date?" — the first tick after Israel midnight runs the
// sweep; after a restart mid-day the sweep runs once for the current day (the
// sweep itself is idempotent per (deal, day), so this can never duplicate).
// DST is handled by israelToday (Intl, Asia/Jerusalem) — no offset arithmetic.

import { prisma } from '../db.js';
import { israelToday } from '../lib/israelDate.js';
import { runMissingTaskSweep } from './autoTasks.js';

const TICK_MS = 5 * 60_000;

let timer = null;
let ticking = false;
let lastSweptDay = null;

export async function runAutoTaskTick(db = prisma, logger = console, nowMs = Date.now()) {
  const day = israelToday(nowMs);
  if (day === lastSweptDay) return { skipped: 'already_swept', day };
  const result = await runMissingTaskSweep({ dateStr: day, db, log: logger });
  lastSweptDay = day;
  return result;
}

export function startAutoTaskWorker(logger = console) {
  if (timer) return;
  timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runAutoTaskTick(prisma, logger);
    } catch (e) {
      logger.error('[auto-tasks] tick failed:', e?.message || e);
    } finally {
      ticking = false;
    }
  }, TICK_MS);
  timer.unref?.();
  logger.log('[auto-tasks] midnight recovery worker started (5m tick)');
}

export function stopAutoTaskWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  lastSweptDay = null;
}
