import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { emailIntegrationConfigured, isInvalidGrant } from './googleClient.js';
import { sendComposedEmail } from './composedSend.js';

// Scheduled-email delivery worker. Same conventions as the WhatsApp scheduled
// worker: 60s tick, claim-based so overlapping runs can never double-send,
// bounded batch, every step idempotent.
//
// Exactly-once guarantees:
//   • A row is CLAIMED with a guarded updateMany (status still 'pending' AND
//     unclaimed) — only one runner can win, so a retry or a second process can
//     never pick up a row that is already being sent.
//   • gmailMessageId is the idempotency marker. Once Gmail has accepted the
//     message the row goes 'sent' and is never eligible again; a row that
//     already carries a gmailMessageId is never re-sent even if a later step
//     failed.
//   • 'cancelled' is terminal and is re-checked inside the claim, so cancelling
//     a row that is due (or mid-tick) prevents delivery.
//
// Failure handling: a genuine send failure records the reason and retries with
// backoff up to MAX_ATTEMPTS. An UNHEALTHY GOOGLE CONNECTION is not a failure
// of the message — the row is preserved, its attempts are NOT consumed, and it
// is retried later, so a token outage never silently drops scheduled mail.

const TICK_MS = 60_000;
const MAX_PER_TICK = 10;
const MAX_ATTEMPTS = 6;
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360];
// Connection problems are re-checked on a slow, fixed cadence (a human has to
// reconnect the account), without consuming the message's own attempts.
const CONNECTION_RETRY_MS = 10 * 60_000;
// A claim older than this is considered abandoned (process died mid-send) and
// may be reclaimed. Comfortably longer than any single send.
const CLAIM_STALE_MS = 10 * 60_000;

const RUNNER_ID = `email-sched-${crypto.randomBytes(4).toString('hex')}`;

function backoffMs(attempts) {
  return BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] * 60_000;
}

function publicOrigin() {
  return String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '') || 'https://app.grafitiyul.co.il';
}

// Rows that are due: pending, time has come, not waiting on a retry, and either
// unclaimed or holding a stale claim.
function dueWhere(now = new Date()) {
  return {
    status: 'pending',
    scheduledAt: { lte: now },
    OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }] }],
  };
}

// Atomically take ownership of one row. Returns true only for the winner.
async function claim(db, row) {
  const res = await db.scheduledEmail.updateMany({
    where: {
      id: row.id,
      status: 'pending', // re-checked: a cancel that landed meanwhile wins
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }],
    },
    data: { claimedAt: new Date(), claimedBy: RUNNER_ID },
  });
  return res.count === 1;
}

export async function deliverScheduledEmail(db, row, deps = {}) {
  const send = deps.send || sendComposedEmail;
  // Idempotency backstop: never send a row Gmail has already accepted.
  if (row.gmailMessageId) {
    await db.scheduledEmail.update({
      where: { id: row.id },
      data: { status: 'sent', claimedAt: null, claimedBy: null },
    });
    return 'already_sent';
  }
  try {
    const result = await send({
      accountId: row.accountId,
      to: row.toJson,
      cc: row.ccJson,
      bcc: row.bccJson,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      bodyText: row.bodyText,
      attachments: row.attachments,
      replyToMessageId: row.replyToMessageId,
      forwardOfMessageId: row.forwardOfMessageId,
      dealId: row.dealId,
      contactId: row.contactId,
      createdByUserId: row.createdById,
      origin: publicOrigin(),
    });
    await db.scheduledEmail.update({
      where: { id: row.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        gmailMessageId: result.gmailMessageId,
        threadId: result.threadId,
        failureReason: null,
        claimedAt: null,
        claimedBy: null,
      },
    });
    return 'sent';
  } catch (e) {
    // Connection-level problems: preserve the row, don't consume an attempt.
    const connectionProblem =
      isInvalidGrant(e) ||
      e?.code === 'no_connected_account' ||
      e?.code === 'email_not_configured' ||
      e?.code === 'google_timeout' ||
      e?.code === 'google_unreachable';
    if (connectionProblem) {
      await db.scheduledEmail.update({
        where: { id: row.id },
        data: {
          connectionDeferredCount: { increment: 1 },
          nextRetryAt: new Date(Date.now() + CONNECTION_RETRY_MS),
          failureReason: 'החיבור ל-Google אינו תקין — הפריט נשמר ויישלח לאחר חיבור מחדש',
          lastAttemptAt: new Date(),
          claimedAt: null,
          claimedBy: null,
        },
      });
      return 'deferred';
    }
    const attempts = (row.attemptCount || 0) + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await db.scheduledEmail.update({
      where: { id: row.id },
      data: {
        status: exhausted ? 'failed' : 'pending',
        attemptCount: attempts,
        lastAttemptAt: new Date(),
        nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
        failureReason: String(e?.code || e?.message || e).slice(0, 300),
        claimedAt: null,
        claimedBy: null,
      },
    });
    return exhausted ? 'failed' : 'retry';
  }
}

export async function runScheduledEmailTick(db = prisma, logger = console, deps = {}) {
  if (!emailIntegrationConfigured()) return { skipped: true };
  const rows = await db.scheduledEmail.findMany({
    where: dueWhere(),
    orderBy: { scheduledAt: 'asc' },
    take: MAX_PER_TICK,
  });
  let sent = 0;
  let deferred = 0;
  let failed = 0;
  for (const row of rows) {
    if (!(await claim(db, row))) continue; // another runner won it
    const outcome = await deliverScheduledEmail(db, row, deps);
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'deferred') deferred += 1;
    else if (outcome === 'failed' || outcome === 'retry') failed += 1;
  }
  if (sent || deferred || failed) {
    logger?.log?.(`[email-scheduled] sent ${sent}, deferred ${deferred}, failed/retry ${failed}`);
  }
  return { sent, deferred, failed };
}

let timer = null;
let ticking = false;

export function startScheduledEmailWorker(logger = console) {
  if (timer) return;
  if (!emailIntegrationConfigured()) {
    logger.log('[email-scheduled] email integration not configured — worker not started');
    return;
  }
  timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runScheduledEmailTick(prisma, logger);
    } catch (e) {
      logger.error('[email-scheduled] tick failed:', e?.message || e);
    } finally {
      ticking = false;
    }
  }, TICK_MS);
  timer.unref?.();
  logger.log('[email-scheduled] worker started (60s tick)');
}

export function stopScheduledEmailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
