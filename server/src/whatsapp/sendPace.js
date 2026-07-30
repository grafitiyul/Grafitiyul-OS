// THE outbound pacing policy for automated WhatsApp sends. One module, one
// constant, every automated sender.
//
// WHY THIS EXISTS
// Three workers used to pace themselves privately — scheduledWorker (1500ms
// between sends, batch of 5), deliveryWorker (1200ms, batch of 10) and
// adminReports (no pacing at all) — and all three ran on the SAME 60s interval,
// started within milliseconds of each other at boot. Each one spaced its own
// sends and none of them knew the others existed, so a tick could interleave
// three streams into a single burst. The bridge serialises sends per account,
// but serialising only makes them sequential as fast as possible; it is not
// spacing.
//
// POLICY (product decision 2026-07-30): long-term account health beats
// throughput. Automated sends from the SAME WhatsApp account are spaced
// ~20 seconds apart. A message scheduled for 08:00 arriving at 08:03 is fine;
// twenty messages leaving at 08:00:00 is not.
//
// MANUAL SENDS: never delayed — an operator hitting send in a live conversation
// waits for nobody. But a manual send STAMPS the account clock (stampManualSend),
// so the next automated message waits its full gap behind it. An automation
// landing one second after a human message is the most bot-like pattern there is.
//
// THE SLOT IS RESERVED IN THE DATABASE, not in process memory:
//   * a deploy mid-wave must not reset the clock and let the next message leave
//     immediately — deploys happen most often when we are actively changing
//     the sending code
//   * if a second GOS instance ever runs, two in-memory pacers would silently
//     double the rate
// Reservation is a single atomic UPDATE … RETURNING, so concurrent callers each
// get their OWN slot instead of all reading the same "next free" value. Same
// pattern as readState.js's monotonic water-mark.

// Spacing between automated sends from one account. Deliberately generous.
export const SEND_GAP_MS = 20_000;

// A caller that would have to wait longer than this gives up its turn instead
// of parking a request for minutes. Only the inline senders use it; workers
// always wait, because a worker's whole job is to wait.
export const MAX_INLINE_WAIT_MS = 90_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Claim the next free slot for this account and return WHEN it is.
//
// GREATEST(now, current) is what makes concurrent claims queue instead of
// collide: each caller pushes the account's next-free stamp forward by one gap
// and receives the value it just consumed. Ten callers arriving together get
// ten slots 20s apart, not ten copies of "now".
// RETURNING sees the NEW row, so "nextSendSlotAt" there is already the advanced
// stamp — subtracting one gap hands back exactly the slot this caller consumed.
const CLAIM_SLOT_SQL = `
  UPDATE "WhatsAppAccount"
     SET "nextSendSlotAt" = GREATEST(
           COALESCE("nextSendSlotAt"::timestamptz, now()),
           now()
         ) + ($2::int * interval '1 millisecond')
   WHERE "id" = $1
  RETURNING ("nextSendSlotAt"::timestamptz - ($2::int * interval '1 millisecond')) AS "slotAt"`;

/**
 * Reserve this account's next automated-send slot and WAIT for it.
 *
 * Returns { waitedMs, slotAt }. Throws nothing on an unknown account — an
 * account with no row is not a reason to refuse a send, and the send itself
 * will fail loudly a moment later if the account is genuinely bogus.
 *
 * `gapMs` and `maxWaitMs` are injectable for tests and for the inline callers.
 */
export async function reserveSendSlot(db, accountId, { gapMs = SEND_GAP_MS, maxWaitMs = null, now = Date.now, wait = sleep } = {}) {
  if (!accountId) return { waitedMs: 0, slotAt: null, skipped: 'no_account' };
  let slotAt = null;
  try {
    const rows = await db.$queryRawUnsafe(CLAIM_SLOT_SQL, String(accountId), Math.max(0, Math.round(gapMs)));
    slotAt = rows?.[0]?.slotAt ? new Date(rows[0].slotAt) : null;
  } catch {
    // Pacing state is not worth failing a send over. Fall back to the gap as a
    // flat delay so we still never burst, and carry on.
    await wait(gapMs);
    return { waitedMs: gapMs, slotAt: null, skipped: 'claim_failed' };
  }
  if (!slotAt) return { waitedMs: 0, slotAt: null, skipped: 'unknown_account' };

  const waitMs = slotAt.getTime() - now();
  if (waitMs <= 0) return { waitedMs: 0, slotAt };
  if (maxWaitMs !== null && waitMs > maxWaitMs) {
    // The caller cannot hold a request this long. The slot stays consumed on
    // purpose: giving it back would let the next caller jump the queue.
    return { waitedMs: 0, slotAt, deferred: true, wouldHaveWaitedMs: waitMs };
  }
  await wait(waitMs);
  return { waitedMs: waitMs, slotAt };
}

/**
 * Record that a MANUAL send just went out. Never delays anything — it only
 * pushes the account's next automated slot out by one gap, so an automation
 * cannot land immediately behind an operator's message.
 *
 * Best-effort by design: a failure here must never break a human's send.
 */
export async function stampManualSend(db, accountId, { gapMs = SEND_GAP_MS } = {}) {
  if (!accountId) return;
  try {
    await db.$queryRawUnsafe(CLAIM_SLOT_SQL, String(accountId), Math.max(0, Math.round(gapMs)));
  } catch {
    /* pacing is advisory; a human send is never blocked by it */
  }
}
