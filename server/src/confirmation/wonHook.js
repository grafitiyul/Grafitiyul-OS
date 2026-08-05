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
import { autoSendFailureReasonHe } from './failureReason.js';
import { GENERIC_CUSTOMER_HE } from '../displayFallbacks.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';

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
  { dealId, transitionKey, closedByUserId = null, suppressed = false },
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

    // The preview's "הפוך ל־WON ושלח" transition: the operator's explicit send
    // owns the email — but the deal must never be silently left WON with no
    // email if that send fails or the preview is closed. A review card stands
    // guard; the successful send resolves it within seconds
    // (resolveConfirmationReview runs on every real send).
    if (suppressed) {
      const { created } = await createReviewItem(
        {
          kind: CONFIRMATION_EMAIL_REVIEW_KIND,
          dedupeKey: `${CONFIRMATION_EMAIL_REVIEW_KIND}:${transitionKey}`,
          title: `מייל אישור ממתין לשליחה — ${customerLabel}${deal.orderNo ? ` (#${deal.orderNo})` : ''}`,
          summary:
            'העסקה הפכה ל-WON מתוך התצוגה המקדימה של מייל האישור. שליחה מהתצוגה סוגרת כרטיס זה אוטומטית; אם הוא נשאר פתוח — מייל האישור עדיין לא נשלח.',
          data: { orderNo: deal.orderNo, operatorDriven, suppressedPreviewSend: true },
          entityRefs: [{ type: 'deal', id: deal.id, orderNo: deal.orderNo, label: customerLabel }],
          dealId: deal.id,
        },
        { db },
      );
      return { pendingReview: true, cardCreated: created, suppressed: true };
    }

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
      if (out.error) {
        // NEVER a silent skip (production #26107: WON with no email, no card,
        // no trace). The failure becomes a review card + a deal-feed event.
        log?.warn?.(`[confirmation] WON auto-send skipped (${dealId}): ${out.error}`);
        // The ACTUAL blocking reason (production #27074: the generic label sent
        // the office hunting a translation problem when the tour was missing).
        const reasonHe = autoSendFailureReasonHe(out.error, out.warnings);
        await createReviewItem(
          {
            kind: CONFIRMATION_EMAIL_REVIEW_KIND,
            dedupeKey: `${CONFIRMATION_EMAIL_REVIEW_KIND}:${transitionKey}`,
            title: `מייל אישור לא נשלח אוטומטית — ${customerLabel}${deal.orderNo ? ` (#${deal.orderNo})` : ''}`,
            summary: `השליחה האוטומטית נעצרה: ${reasonHe}. פתחו תצוגה מקדימה, השלימו ושלחו.`,
            data: {
              orderNo: deal.orderNo,
              operatorDriven,
              autoSendError: out.error,
              // Raw composer warnings, frozen — the card UI can expose detail.
              autoSendWarnings: out.warnings || null,
            },
            entityRefs: [{ type: 'deal', id: deal.id, orderNo: deal.orderNo, label: customerLabel }],
            dealId: deal.id,
          },
          { db },
        ).catch(() => {});
        await emitTimelineEvent(db, {
          subjectId: deal.id,
          kind: 'communication',
          origin: systemOrigin(),
          data: {
            event: 'confirmation_email_auto_failed',
            channel: 'email',
            error: out.error,
            errorHe: reasonHe,
            eventName: 'מייל אישור — שליחה אוטומטית נעצרה',
          },
        }).catch(() => {});
      }
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
