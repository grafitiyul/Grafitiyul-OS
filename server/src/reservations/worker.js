// Travel Agency Reservations — processing sweep (Slice 3). The async safety
// net behind the inline submit-time attempt: picks up sessions the inline
// pass missed (crash between intake commit and processing, expired claims)
// and retries partially/fully failed sessions on their nextRetryAt backoff.
// Claim semantics live in the processor — this worker only decides WHAT is
// due. In-process 60s tick, same convention as the other workers.

import { prisma } from '../db.js';
import { processReservationSession, MAX_ATTEMPTS } from './processor.js';

const TICK_MS = 60_000;
// A freshly submitted session gets a short grace so the inline attempt wins;
// the sweep exists for the crash window, not to race every submission.
const SUBMIT_GRACE_MS = 60_000;
let started = false;
let inFlight = false;

// One pass: process every due session, oldest first. Injectable for tests.
export async function sweepDueSessions(db = prisma, { now = new Date(), limit = 20 } = {}) {
  const due = await db.reservationSession.findMany({
    where: {
      OR: [
        // Never processed: inline attempt died before/while processing.
        {
          status: 'submitted',
          submittedAt: { lt: new Date(now.getTime() - SUBMIT_GRACE_MS) },
        },
        // A processor crashed mid-run and its claim lapsed.
        { status: 'processing', claimExpiresAt: { lt: now } },
        // Scheduled retries with attempts remaining.
        {
          status: { in: ['partially_processed', 'failed'] },
          nextRetryAt: { lte: now },
          attemptCount: { lt: MAX_ATTEMPTS },
        },
      ],
    },
    orderBy: { submittedAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let handled = 0;
  for (const s of due) {
    const r = await processReservationSession(s.id, db).catch(() => null);
    if (r?.claimed) handled += 1;
  }
  return handled;
}

export function startReservationWorker(log = console) {
  if (started) return;
  started = true;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const n = await sweepDueSessions();
      if (n) log?.log?.(`[reservations] processed ${n} due session(s)`);
    } catch (e) {
      log?.warn?.('[reservations] tick failed:', e?.message);
    } finally {
      inFlight = false;
    }
  };
  setInterval(tick, TICK_MS).unref?.();
}
