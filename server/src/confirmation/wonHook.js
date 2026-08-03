// Confirmation Email — the automatic first send on a genuine WON transition.
//
// WHERE THIS HANGS: emitWonTransitionEffects (deals/wonTransition.js) is the
// ONE post-commit funnel, invoked exactly once per real non-WON→WON flip
// (the atomic updateMany decides the winner). Hooking here means every path —
// operator click, card payment, iCount IPN, Cardcom, register-without-payment
// — gets the behaviour without a single provider knowing about email, and
// migrations/backfills (which write status directly, never through the
// transition) can never trigger a customer email.
//
// THE DECISION:
//   no fillers          → send now. Standard email, nothing to review (D3).
//   fillers + operator  → a review card AND the UI opens the preview: the
//                         operator is right there, but if they walk away the
//                         card is still the office's reminder.
//   fillers + system    → a review card only. A webhook has no browser; an
//                         email carrying negotiated terms is never sent blind.
// Sending (from anywhere) resolves the card — see resolveConfirmationReview.
//
// Operator vs system is read from `closedByUserId`: every webhook path passes
// systemOrigin() ⇒ createdBy null, while operator routes carry a real
// adminAuth user id.

import { prisma as defaultPrisma } from '../db.js';
import { createReviewItem, handleReviewItem } from '../reviewItems/service.js';
import { CONFIRMATION_EMAIL_REVIEW_KIND } from '../reviewItems/kinds/confirmationEmailReview.js';
import { hasActiveFillers } from './fillers.js';
import { sendConfirmationEmail } from './sendService.js';
import { GENERIC_CUSTOMER_HE } from '../displayFallbacks.js';

// Canonical customer wording for the card: organization → contact → generic.
// NEVER Deal.title (internal CRM wording — the gallery-incident invariant).
function customerLabelFor(deal) {
  if (deal?.organization?.name) return deal.organization.name;
  const c = deal?.contacts?.[0]?.contact;
  const name = [c?.firstNameHe, c?.lastNameHe].filter(Boolean).join(' ').trim()
    || [c?.firstNameEn, c?.lastNameEn].filter(Boolean).join(' ').trim();
  return name || GENERIC_CUSTOMER_HE;
}

/**
 * Fire-and-forget: never throws into the WON caller. `wonTransitionKey` is the
 * immutable identity of THIS transition, so a replayed webhook or a
 * double-clicked button produces at most one card and one send workflow.
 */
export async function runConfirmationOnWon(
  { dealId, transitionKey, closedByUserId = null },
  { db = defaultPrisma, log = console } = {},
) {
  try {
    const deal = await db.deal.findUnique({
      where: { id: dealId },
      select: {
        id: true,
        orderNo: true,
        // Deal.title is INTERNAL CRM wording and is deliberately NOT selected
        // (src/dealTitleGuard.test.js). The card names the customer from the
        // canonical chain instead: organization → contact → generic.
        organization: { select: { name: true } },
        contacts: {
          select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } },
          orderBy: { isPrimary: 'desc' },
          take: 1,
        },
        confirmation: { select: { fillers: true } },
      },
    });
    if (!deal) return { skipped: 'deal_not_found' };
    const customerLabel = customerLabelFor(deal);

    const fillers = hasActiveFillers(deal.confirmation?.fillers);
    const operatorDriven = !!closedByUserId;

    if (!fillers) {
      const out = await sendConfirmationEmail(
        {
          dealId,
          trigger: 'won_auto',
          actorUserId: closedByUserId || null,
          // The deal just became WON in the committed transaction.
          allowNotWon: false,
        },
        { db },
      );
      if (out.error) log?.warn?.(`[confirmation] WON auto-send skipped (${dealId}): ${out.error}`);
      return { sent: !!out.ok, error: out.error || null };
    }

    // Fillers present — a person must read it first.
    const { created } = await createReviewItem(
      {
        kind: CONFIRMATION_EMAIL_REVIEW_KIND,
        // One card per genuine transition; a replay collides and is dropped.
        dedupeKey: `${CONFIRMATION_EMAIL_REVIEW_KIND}:${transitionKey}`,
        title: `מייל אישור ממתין לאישור — ${customerLabel}${deal.orderNo ? ` (#${deal.orderNo})` : ''}`,
        summary: operatorDriven
          ? 'העסקה נסגרה עם תנאי עסקה מיוחדים. פתחו תצוגה מקדימה, בדקו ושלחו.'
          : 'העסקה נסגרה אוטומטית (תשלום) עם תנאי עסקה מיוחדים. מייל האישור לא נשלח — פתחו תצוגה מקדימה, בדקו ושלחו.',
        data: { orderNo: deal.orderNo, operatorDriven },
        entityRefs: [{ type: 'deal', id: deal.id, orderNo: deal.orderNo, label: customerLabel }],
        dealId: deal.id,
      },
      { db },
    );
    return { pendingReview: true, cardCreated: created };
  } catch (e) {
    log?.error?.(`[confirmation] WON hook failed (${dealId}): ${e?.message || e}`);
    return { error: 'hook_failed' };
  }
}

/**
 * A real send answers the card. Called after every non-test send so the
 * office never has to tick it manually and no stuck state survives.
 */
export async function resolveConfirmationReview(sendId, dealId, adminAuth = null, { db = defaultPrisma } = {}) {
  try {
    const open = await db.reviewItem.findFirst({
      where: { kind: CONFIRMATION_EMAIL_REVIEW_KIND, dealId, status: 'open' },
      select: { id: true },
    });
    if (!open) return { resolved: false };
    await handleReviewItem(
      open.id,
      { userId: adminAuth?.userId || null, userName: adminAuth?.userName || null },
      { db }, // must ride the SAME client — a default here would bypass a tx
    );
    return { resolved: true };
  } catch {
    return { resolved: false }; // never fail a successful send over bookkeeping
  }
}

/** Is a confirmation email waiting for review on this deal? (Deal DTO flag.) */
export async function confirmationReviewPending(dealId, { db = defaultPrisma } = {}) {
  const open = await db.reviewItem.findFirst({
    where: { kind: CONFIRMATION_EMAIL_REVIEW_KIND, dealId, status: 'open' },
    select: { id: true },
  });
  return !!open;
}
