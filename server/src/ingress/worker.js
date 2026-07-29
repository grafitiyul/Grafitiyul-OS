// Ingress Platform — the retry worker.
//
// Claim-based 60s tick, the same pattern the reservations processor and the
// whatsapp scheduled worker already use: a conditional updateMany with a TTL
// means several instances can run without double-processing, and a crashed
// claim is reclaimed after the TTL rather than wedging the event forever.
//
// Only `pending` events with a due nextRetryAt are picked up. Permanent
// failures (`failed`) and exhausted ones (`dead`) are deliberately left alone —
// they need a human or a code fix, and silently retrying them would hide that.

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { replayEvent } from './replay.js';

export const CLAIM_TTL_MS = 2 * 60 * 1000;
const TICK_MS = 60 * 1000;
const BATCH = 20;

const WORKER_ID = `ingress-${crypto.randomUUID().slice(0, 8)}`;

// Claim one event: conditional update, so exactly one worker can win it.
async function claimOne(db, now) {
  const candidates = await db.ingressEvent.findMany({
    where: {
      status: 'pending',
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_TTL_MS) } }] }],
    },
    orderBy: { receivedAt: 'asc' },
    take: BATCH,
    select: { id: true, claimedAt: true },
  });

  for (const c of candidates) {
    const res = await db.ingressEvent.updateMany({
      // The claim predicate repeats the freshness condition so a concurrent
      // winner between findMany and updateMany loses here (count === 0).
      where: {
        id: c.id,
        status: 'pending',
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_TTL_MS) } }],
      },
      data: { claimedAt: now, claimedBy: WORKER_ID },
    });
    if (res.count === 1) return c.id;
  }
  return null;
}

export async function runIngressRetryTick(db = prisma, logger = console) {
  const now = new Date();
  let processed = 0;
  for (let i = 0; i < BATCH; i++) {
    const id = await claimOne(db, now);
    if (!id) break;
    try {
      const r = await replayEvent(id, { db });
      processed++;
      if (r?.status && r.status !== 'processed') {
        logger.log(`[ingress-retry] ${id} → ${r.status}${r.failureCode ? ` (${r.failureCode})` : ''}`);
      }
    } catch (err) {
      // replayEvent already records the failure on the row; this catch only
      // stops one bad event from ending the tick.
      logger.error(`[ingress-retry] ${id} threw`, err?.code || err?.message);
      await db.ingressEvent
        .update({ where: { id }, data: { claimedAt: null, claimedBy: null } })
        .catch(() => {});
    }
  }
  return processed;
}

export function startIngressRetryWorker(logger = console) {
  logger.log('[ingress-retry] worker started (60s tick)');
  const tick = async () => {
    try {
      await runIngressRetryTick(prisma, logger);
    } catch (err) {
      logger.error('[ingress-retry] tick failed', err?.message);
    }
  };
  const handle = setInterval(tick, TICK_MS);
  if (handle.unref) handle.unref();
  return handle;
}
