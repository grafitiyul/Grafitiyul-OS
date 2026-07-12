import { prisma } from '../db.js';

// בקרה sweep worker — runs every registered detector on a 60s tick (same
// conventions as the WhatsApp/email/gallery workers: in-process, re-entrancy
// guarded, a failing detector never breaks the others). Detectors are pure
// "re-derive from live domain state" scans: they raise issues that are
// missing and auto-resolve issues whose underlying condition is gone, so the
// dashboard can never drift from reality.

const TICK_MS = 60_000;

const detectors = [];

export function registerDetector(detector) {
  detectors.push(detector);
}

let inFlight = false;

export async function runControlSweep(log = console) {
  if (inFlight) return;
  inFlight = true;
  try {
    for (const d of detectors) {
      try {
        await d.run(prisma, log);
      } catch (e) {
        log?.warn?.(`[control] detector "${d.key}" failed:`, e?.message);
      }
    }
  } finally {
    inFlight = false;
  }
}

let started = false;

export function startControlSweepWorker(log = console) {
  if (started) return;
  started = true;
  setInterval(() => runControlSweep(log), TICK_MS).unref?.();
  // First sweep shortly after boot so the dashboard is honest immediately.
  setTimeout(() => runControlSweep(log), 5_000).unref?.();
  log?.log?.(`[control] sweep worker started (${detectors.length} detectors)`);
}
