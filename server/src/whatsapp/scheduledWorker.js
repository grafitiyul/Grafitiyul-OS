// Scheduled WhatsApp messages worker (Slice 7) — claim-based, ported from the
// proven Challenge System worker. Text-only V1, runs inside the GOS server
// process (one instance today; the claim semantics stay correct even if a
// second instance ever appears).
//
// Tick (every 60s):
//   0a. recovery — 'sending' rows whose claim expired are demoted back to
//       'pending' with attemptCount decremented, so the re-claim regenerates
//       the SAME idempotency key and the bridge replays instead of resending.
//   0b. stale — 'pending' rows >2h past their time are skipped (never send a
//       "good morning" at midnight because the bridge was down all day).
//   1.  claim due rows ATOMICALLY: updateMany({ id, status:'pending', claim
//       free/expired } → 'sending'+claim). count===0 ⇒ someone else won.
//   2.  send via the bridge with idempotencyKey
//       `gos-sched-<id>-<scheduledAtISO>-a<attemptCount>`.
//   3.  classify failures:
//         terminal            → 'failed' (whatsapp_number_not_found, invalid_payload)
//         retryable_connection→ back to 'pending', attempt NOT consumed,
//                               retry in 30s (bridge down / reconnecting)
//         retryable_send      → back to 'pending' on the backoff ladder,
//                               'failed' after MAX_ATTEMPTS
//   4.  1.5s pacing between sends (anti-burst).
//
// Cancel/reschedule race safety: admin mutations are guarded updateMany
// (status:'pending'), so a row being sent right now can't be edited — the
// API returns a conflict instead of pretending.

import { prisma } from '../db.js';
import { callBridge, bridgeUrlMap } from './bridgeClient.js';

const TICK_MS = 60_000;
const TICK_BATCH = 5;
const SEND_PACING_MS = 1500;
const MAX_ATTEMPTS = 8;
const CLAIM_TTL_MS = 5 * 60_000;
const CONNECTION_DEFER_MS = 30_000;
const STALE_AGE_MS = 2 * 60 * 60_000;
const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000, 120 * 60_000, 240 * 60_000];

const WORKER_ID = `gos-${process.pid}-${Date.now()}`;
const STALE_REASON = 'פג תוקף — מועד השליחה עבר מזמן וההודעה לא נשלחה. קבעו מועד חדש.';

const CONNECTION_CODES = new Set([
  'whatsapp_not_connected',
  'bridge_not_configured',
  'bridge_unreachable',
  'send_timeout',
  'on_whatsapp_timeout',
  'on_whatsapp_failed',
  'bridge_auth_failed',
]);
const TERMINAL_CODES = new Set(['whatsapp_number_not_found', 'invalid_payload']);

export function classify(err) {
  const code = err?.data?.error || err?.code || (err instanceof Error ? err.message : 'send_failed');
  if (TERMINAL_CODES.has(code)) return { kind: 'terminal', code };
  if (CONNECTION_CODES.has(code)) return { kind: 'retryable_connection', code };
  // bridge unreachable network-level (fetch abort/refused) lands as bridge_error/undefined
  if (code === 'bridge_error' || /fetch failed|abort/i.test(String(err?.message))) {
    return { kind: 'retryable_connection', code: 'bridge_unreachable' };
  }
  return { kind: 'retryable_send', code: String(code).slice(0, 80) };
}

export function idempotencyKeyFor(row) {
  return `gos-sched-${row.id}-${row.scheduledAt.toISOString()}-a${row.attemptCount}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tick(log) {
  const now = new Date();
  const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS);
  const staleCutoff = new Date(now.getTime() - STALE_AGE_MS);

  // 0a. recovery sweep — expired 'sending' claims back to 'pending'.
  const stuck = await prisma.whatsAppScheduledMessage.findMany({
    where: { status: 'sending', OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
    select: { id: true, attemptCount: true },
  });
  for (const r of stuck) {
    log.warn(`[whatsapp-scheduled] recovering stuck 'sending' row ${r.id}`);
    await prisma.whatsAppScheduledMessage.update({
      where: { id: r.id },
      data: {
        status: 'pending',
        claimedAt: null,
        claimedBy: null,
        attemptCount: Math.max(0, r.attemptCount - 1),
      },
    });
  }

  // 0b. stale expiry — honesty over late surprises.
  await prisma.whatsAppScheduledMessage.updateMany({
    where: { status: 'pending', scheduledAt: { lt: staleCutoff } },
    data: { status: 'skipped', failureReason: STALE_REASON },
  });

  // 1. due candidates.
  const candidates = await prisma.whatsAppScheduledMessage.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: now, gte: staleCutoff },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] }],
    },
    orderBy: { scheduledAt: 'asc' },
    take: TICK_BATCH,
    select: { id: true },
  });

  let sent = 0;
  for (let i = 0; i < candidates.length; i++) {
    const { id } = candidates[i];

    // 2. atomic claim — losers see count 0.
    const claimed = await prisma.whatsAppScheduledMessage.updateMany({
      where: { id, status: 'pending', OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
      data: {
        status: 'sending',
        claimedAt: now,
        claimedBy: WORKER_ID,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
      },
    });
    if (claimed.count === 0) continue;

    const row = await prisma.whatsAppScheduledMessage.findUnique({
      where: { id },
      include: { chat: { select: { externalChatId: true, accountId: true } } },
    });
    if (!row || row.claimedBy !== WORKER_ID || row.status !== 'sending') continue;

    try {
      const data = await callBridge(row.chat.accountId, '/send', {
        method: 'POST',
        timeoutMs: 25_000,
        body: {
          jid: row.chat.externalChatId,
          text: row.content,
          idempotencyKey: idempotencyKeyFor(row),
        },
      });
      await prisma.whatsAppScheduledMessage.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          externalMessageId: data?.externalMessageId ?? null,
          failureReason: null,
          claimedAt: null,
          claimedBy: null,
        },
      });
      sent++;
      log.info(`[whatsapp-scheduled] sent id=${id} account=${row.accountId}`);
    } catch (err) {
      const c = classify(err);
      if (c.kind === 'retryable_connection') {
        // Bridge/connection problem — not this message's fault; give the
        // attempt back and retry shortly.
        await prisma.whatsAppScheduledMessage.update({
          where: { id },
          data: {
            status: 'pending',
            failureReason: c.code,
            attemptCount: Math.max(0, row.attemptCount - 1),
            connectionDeferredCount: { increment: 1 },
            nextRetryAt: new Date(Date.now() + CONNECTION_DEFER_MS),
            claimedAt: null,
            claimedBy: null,
          },
        });
        log.warn(`[whatsapp-scheduled] deferred id=${id} (${c.code})`);
      } else {
        const isTerminal = c.kind === 'terminal' || row.attemptCount >= MAX_ATTEMPTS;
        const delay = RETRY_DELAYS_MS[Math.min(row.attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
        await prisma.whatsAppScheduledMessage.update({
          where: { id },
          data: {
            status: isTerminal ? 'failed' : 'pending',
            failureReason: c.code,
            nextRetryAt: isTerminal ? null : new Date(Date.now() + delay),
            claimedAt: null,
            claimedBy: null,
          },
        });
        log.warn(`[whatsapp-scheduled] ${isTerminal ? 'FAILED' : 'retry scheduled'} id=${id} (${c.code})`);
      }
    }

    if (i < candidates.length - 1) await sleep(SEND_PACING_MS);
  }
  return sent;
}

export function startScheduledWorker(log = console) {
  if (Object.keys(bridgeUrlMap()).length === 0) {
    log.info('[whatsapp-scheduled] no bridges configured — worker not started');
    return null;
  }
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await tick(log);
    } catch (err) {
      log.error(`[whatsapp-scheduled] tick crashed: ${err?.message || err}`);
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info('[whatsapp-scheduled] worker started (60s tick)');
  return timer;
}
