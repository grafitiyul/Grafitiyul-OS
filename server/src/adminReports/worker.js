// Admin Reports retry worker — 60s tick. The dispatcher sends inline; this
// only picks up rows whose send failed for a transient reason (bridge down),
// on the same backoff the dispatcher stamped. Frozen text ⇒ a retry re-sends
// exactly what was originally reported.

import { prisma } from '../db.js';
import { bridgeUrlMap } from '../whatsapp/bridgeClient.js';
import { sendDelivery } from './dispatch.js';

const TICK_MS = 60_000;
const BATCH = 5;

async function tick(log) {
  const now = new Date();
  const due = await prisma.adminReportDelivery.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      // Only rows that actually have a destination to retry against.
      waAccountId: { not: null },
      waChatId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });
  for (const row of due) {
    // Claim by bumping the retry stamp first, so a second instance skips it.
    const claimed = await prisma.adminReportDelivery.updateMany({
      where: { id: row.id, status: row.status },
      data: { nextRetryAt: new Date(Date.now() + 5 * 60_000) },
    });
    if (claimed.count === 0) continue;
    await sendDelivery(row, log);
  }
}

export function startAdminReportsWorker(log = console) {
  if (Object.keys(bridgeUrlMap()).length === 0) {
    log.info('[admin-reports] no WhatsApp bridges configured — worker not started');
    return null;
  }
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await tick(log);
    } catch (err) {
      log.error(`[admin-reports] tick crashed: ${err?.message || err}`);
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info('[admin-reports] retry worker started (60s tick)');
  return timer;
}
