// THE canonical WON transition — the single owner of what "the deal became
// WON" means. Every path that closes a deal (operator WON button, verified
// credit-card payment, iCount IPN settlement, register-without-payment) funnels
// through transitionDealToWon; no other code writes status='won'.
//
// Invariants owned here:
//   * status → 'won' exactly once per genuine transition (atomic conditional
//     update — the guard, not a pre-read, decides the race);
//   * the deal moves to the FINAL stage of the pipeline in the same write
//     (resolved by canonical sortOrder — never a hardcoded stage id/name);
//   * wonAt is stamped and the structured lost fields are cleared, identically
//     for every path (before this service, an IPN-won deal had wonAt=null);
//   * wonQuoteRef is stamped only on the actual transition (a re-save of an
//     already-won deal never re-points the audit record);
//   * post-commit effects (Communication Center triggers + Manager Report #26)
//     fire exactly once, from the transaction that actually flipped the status.
//
// Tour creation is deliberately NOT here: the manual route and the payment
// family resolve their tour target differently (explicit slot vs. held
// reservation) and both keep calling createTourForWonDeal themselves — in the
// same transaction, after this transition succeeds.

import { fireCommunicationTrigger } from '../communication/engine.js';
import { buildWonQuoteRef } from '../quote/quoteOffers.js';
import { fireDealWonReport } from '../adminReports/dealWonEvent.js';
import { runConfirmationOnWon } from '../confirmation/wonHook.js';

/**
 * The final stage of the pipeline: the last ACTIVE stage in the canonical
 * display order (sortOrder asc, label asc → final = the reverse). Throws a
 * coded `no_final_stage` when no active stage exists — the transition must
 * stop rather than leave a WON deal on a stale stage.
 */
export async function resolveFinalStage(client) {
  const stage = await client.dealStage.findFirst({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'desc' }, { label: 'desc' }],
    select: { id: true, key: true, label: true },
  });
  if (!stage) {
    const e = new Error('no_final_stage');
    e.code = 'no_final_stage';
    throw e;
  }
  return stage;
}

/**
 * The immutable identity of ONE WON transition — wonAt is stamped exactly once
 * per genuine transition (preserved on reopen, restamped only by the next real
 * win), so a re-won deal notifies again while retries of the same transition
 * cannot. This string is the Report #26 idempotency key.
 */
export const wonTransitionKey = (dealId, wonAt) =>
  `won_transition:${dealId}:${new Date(wonAt).getTime()}`;

/**
 * Move a deal to WON inside the caller's transaction.
 *
 * Returns { wonNow, alreadyWon, deal, before, finalStage, wonAt } where `deal`
 * is the post-transition scalar row (merged, not re-read) and `before` is the
 * pre-transition row for the caller's changelog. Idempotent: an already-WON
 * deal (including one won by a concurrent transaction between our read and
 * write) returns { alreadyWon: true } and changes nothing.
 */
export async function transitionDealToWon(tx, { dealId, publicOrigin = null }) {
  const before = await tx.deal.findUnique({ where: { id: dealId } });
  if (!before) {
    const e = new Error('deal_not_found');
    e.code = 'deal_not_found';
    throw e;
  }
  if (before.status === 'won') return { wonNow: false, alreadyWon: true, deal: before, before };

  const finalStage = await resolveFinalStage(tx);

  // Stamp the PRIMARY quote this win is based on — only on the transition.
  const ref = await buildWonQuoteRef(tx, dealId);
  const wonQuoteRef = ref
    ? {
        ...ref,
        publicUrl: publicOrigin ? `${publicOrigin}/quote/${ref.publicToken}` : null,
        stampedAt: new Date().toISOString(),
      }
    : null;

  const wonAt = new Date();
  const data = {
    status: 'won',
    dealStageId: finalStage.id,
    wonAt,
    lostAt: null,
    lostReasonId: null,
    lostNotes: null,
    lostReason: null,
    wonQuoteRef,
  };
  // The atomic guard IS the race decision: two concurrent transitions (two
  // operator tabs, operator + webhook, two provider callbacks) both reach this
  // line, exactly one matches status≠'won' after row-lock release.
  const upd = await tx.deal.updateMany({ where: { id: dealId, status: { not: 'won' } }, data });
  if (upd.count === 0) {
    return { wonNow: false, alreadyWon: true, deal: { ...before, status: 'won' }, before };
  }

  return {
    wonNow: true,
    alreadyWon: false,
    deal: { ...before, ...data },
    before,
    finalStage,
    wonAt,
  };
}

/**
 * Post-commit effects of ONE genuine WON transition. Callers invoke this
 * exactly once, only when transitionDealToWon returned wonNow:true, AFTER
 * their transaction committed. Fire-and-forget: never throws into the caller.
 *
 * `closedByUserId` — the authenticated operator for operator-driven wins;
 * `cause: 'card_payment'` marks an automatic payment-driven win (attributed to
 * the system, never a fabricated human). `paymentAmountMinor` — the verified
 * amount of the payment that caused the win, when there is one.
 */
export function emitWonTransitionEffects(
  { dealId, wonAt, cause = null, closedByUserId = null, paymentAmountMinor = null,
    skipConfirmationEmail = false },
  log = console,
) {
  fireCommunicationTrigger({ type: 'deal_won', dealId }, log);
  // Tour-anchored ("מועד הסיור") reminder deliveries materialize with the
  // now-attached tour; the worker re-anchors on later date moves.
  fireCommunicationTrigger({ type: 'tour_datetime', dealId }, log);
  fireDealWonReport(
    {
      dealId,
      idempotencyKey: wonTransitionKey(dealId, wonAt),
      cause,
      closedByUserId,
      paymentAmountMinor,
    },
    log,
  );
  // Confirmation email (מייל אישור). Hooked HERE so every WON path — operator,
  // card payment, IPN, Cardcom — behaves identically and no provider needs to
  // know about email. Deals with special terms produce a review card instead
  // of a blind send; see confirmation/wonHook.js. Fire-and-forget.
  // Suppressed when the operator is sending from the preview RIGHT NOW:
  // the explicit send owns the email, so the hook must not queue a second
  // one (nor raise a review card that the send would immediately resolve).
  if (!skipConfirmationEmail) {
    runConfirmationOnWon(
    { dealId, transitionKey: wonTransitionKey(dealId, wonAt), closedByUserId },
    { log },
    ).catch(() => {});
  }
}
