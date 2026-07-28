// Admin Reports retry worker — 60s tick. The dispatcher sends inline; this
// only picks up rows whose send failed for a transient reason (bridge down),
// on the same backoff the dispatcher stamped. Frozen text ⇒ a retry re-sends
// exactly what was originally reported.

import { prisma } from '../db.js';
import { bridgeUrlMap } from '../whatsapp/bridgeClient.js';
import { sendDelivery } from './dispatch.js';
import { runDueScheduledReports } from './daily.js';
import { runTourSweeps } from './tourSweeps.js';

const TICK_MS = 60_000;
const BATCH = 5;

async function tick(log) {
  const now = new Date();

  // Daily scheduled reports ride THIS tick — no second scheduler. Each is
  // idempotent on `daily:<number>:<Israel date>`, so a restart, a slow tick or
  // a future second instance can never double-send.
  // Per-tour guide notifications ride the SAME tick — due-ness is computed
  // from canonical tour times, so there is no second scheduler and no stored
  // schedule to drift.
  await runTourSweeps({ log }).catch((e) => log.error?.(`[admin-reports] tour sweeps failed: ${e?.message || e}`));
  await runDueScheduledReports({ log }).catch((e) => log.error?.(`[admin-reports] daily sweep failed: ${e?.message || e}`));
  const due = await prisma.adminReportDelivery.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      waAccountId: { not: null },
      // Two independent OR groups — they must be ANDed, not merged into one
      // `OR` key (the second would silently replace the first and retries would
      // fire before their backoff).
      AND: [
        { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        // A destination to retry against: a configured group chat, or a
        // per-person phone (guide-audience reports).
        { OR: [{ waChatId: { not: null } }, { recipientPhone: { not: null } }] },
      ],
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
