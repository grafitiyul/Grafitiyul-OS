// A genuine non-WON → WON transition → Manager Report #26.
//
// ── Who calls this ──────────────────────────────────────────────────────────
// ONLY deals/wonTransition.js (emitWonTransitionEffects), post-commit, and
// only from the transaction that actually flipped the status. That wiring IS
// the "genuine transition" rule: migration imports, mirror creates, re-saves
// of an already-WON deal and webhook retries never reach the transition core's
// wonNow:true branch, so they can never reach this file either.
//
// ── Exactly once ────────────────────────────────────────────────────────────
// The idempotency key is won_transition:<dealId>:<wonAt-millis> — the
// immutable identity of ONE transition (wonAt is stamped exactly once per
// genuine win). A reopened deal that is later won again carries a new wonAt,
// so it legitimately notifies once more; the unique
// (reportNumber, idempotencyKey) index drops anything else.

import { fireAdminReport } from './dispatch.js';
import { actorForReport } from './actor.js';

/** Report ONE deal-became-WON transition. Never throws into the caller. */
export async function reportDealWon(
  { dealId, idempotencyKey, cause = null, closedByUserId = null, paymentAmountMinor = null },
  log = console,
) {
  if (!dealId || !idempotencyKey) return { ok: false, reason: 'bad_payload' };
  // The REAL authenticated user is frozen into the payload at fire time (same
  // contract as report #3's actor) — never re-derived, never the deal owner.
  const closedBy = closedByUserId ? await actorForReport(closedByUserId) : null;
  return fireAdminReport({
    number: 26,
    idempotencyKey,
    dealId,
    data: {
      wonReport: {
        cause,
        closedBy,
        paymentAmountMinor: paymentAmountMinor == null ? null : Number(paymentAmountMinor),
      },
    },
  }, log);
}

/** Fire-and-forget entry point — never able to fail the WON transition. */
export function fireDealWonReport(payload, log = console) {
  setImmediate(() => {
    reportDealWon(payload, log).catch((err) => {
      log.error?.(`[admin-reports] deal-won report failed: ${err?.message || err}`);
    });
  });
}
