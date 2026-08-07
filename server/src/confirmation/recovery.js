// Confirmation Email — the recovery retry, fired after a WON deal finally got
// its tour (the "השלם פרטי סיור וצור סיור" flow, deals/completeTourSetup).
//
// Mirrors the WON hook's decision table exactly — one behaviour, two moments:
//   already sent + no open card → nothing to do
//   fillers active              → the operator must read first: preview opens,
//                                 the open review card stays the guard
//   no fillers                  → send now; success resolves the review card,
//                                 failure UPDATES it with the truthful reason
//                                 (failureReason.js) instead of leaving the
//                                 stale pre-recovery wording.
//
// Idempotent by construction: countRealSends gates re-entry, sendService's
// duplicate window absorbs double-clicks, and the card is keyed to the WON
// transition — retries refresh it, never multiply it.

import { prisma as defaultPrisma } from '../db.js';
import { sendConfirmationEmail } from './sendService.js';
import { countRealSends } from './sendHistory.js';
import { hasActiveFillers } from './fillers.js';
import { autoSendFailureReasonHe } from './failureReason.js';
import { resolveConfirmationReview } from './wonHook.js';
import { resolveDelivery } from '../email/deliveryState.js';
import { CONFIRMATION_EMAIL_REVIEW_KIND } from '../reviewItems/kinds/confirmationEmailReview.js';
import { emitTimelineEvent, userOrigin, systemOrigin } from '../timeline/events.js';

/**
 * Returns the same action vocabulary the apply-tour-update flow already
 * speaks: { action: 'sent' | 'preview' | 'failed' | 'skipped', ... } — the
 * client handles all four without new concepts.
 */
export async function retryConfirmationAfterTourSetup(
  { dealId, actorUserId = null },
  { db = defaultPrisma, log = console } = {},
) {
  try {
    const deal = await db.deal.findUnique({
      where: { id: dealId },
      select: { id: true, status: true, confirmation: { select: { fillers: true } } },
    });
    if (!deal) return { action: 'skipped', reason: 'deal_not_found' };
    if (deal.status !== 'won') return { action: 'skipped', reason: 'deal_not_won' };

    const openCard = await db.reviewItem.findFirst({
      where: { kind: CONFIRMATION_EMAIL_REVIEW_KIND, dealId, status: 'open' },
      select: { id: true, data: true },
    });
    // A confirmation already went out and nothing is waiting on review — a
    // repeat click / refresh must not mail the customer twice.
    if (!openCard && (await countRealSends(db, dealId)) > 0) {
      return { action: 'skipped', reason: 'already_sent' };
    }

    if (hasActiveFillers(deal.confirmation?.fillers)) {
      // Special terms are never sent blind — the caller opens the preview;
      // the open card (if any) keeps standing guard until the real send.
      return { action: 'preview' };
    }

    const out = await sendConfirmationEmail(
      { dealId, trigger: 'won_auto', actorUserId },
      { db },
    );
    if (out.ok) {
      await resolveConfirmationReview(
        out.sendId,
        dealId,
        actorUserId ? { userId: actorUserId } : null,
        { db },
      );
      // Canonical delivery state travels with the result — 'sent' here means
      // "handed to the queue", and the toast must say exactly that.
      return {
        action: 'sent',
        sendId: out.sendId,
        subject: out.subject,
        sendKind: out.sendKind,
        delivery: await resolveDelivery(out.scheduledEmailId, { db }),
        windowHold: out.windowHold || null,
      };
    }

    const reasonHe = autoSendFailureReasonHe(out.error, out.warnings);
    if (openCard) {
      // Refresh the guard with the CURRENT truth — the pre-recovery reason
      // ("אין סיור משובץ") is gone; whatever still blocks is what must show.
      await db.reviewItem
        .update({
          where: { id: openCard.id },
          data: {
            summary: `השליחה האוטומטית נעצרה: ${reasonHe}. פתחו תצוגה מקדימה, השלימו ושלחו.`,
            data: {
              ...(openCard.data || {}),
              autoSendError: out.error,
              autoSendWarnings: out.warnings || null,
            },
          },
        })
        .catch(() => {});
      // A NEW blocking reason is feed-worthy; the same one again is not.
      if ((openCard.data || {}).autoSendError !== out.error) {
        await emitTimelineEvent(db, {
          subjectId: dealId,
          kind: 'communication',
          origin: actorUserId ? await userOrigin(actorUserId) : systemOrigin(),
          data: {
            event: 'confirmation_email_auto_failed',
            channel: 'email',
            error: out.error,
            errorHe: reasonHe,
            eventName: 'מייל אישור — שליחה אוטומטית נעצרה',
          },
        }).catch(() => {});
      }
    }
    return { action: 'failed', error: out.error, reasonHe, warnings: out.warnings || null };
  } catch (e) {
    log?.error?.(`[confirmation] recovery retry failed (${dealId}): ${e?.message || e}`);
    return { action: 'failed', error: 'retry_failed' };
  }
}
