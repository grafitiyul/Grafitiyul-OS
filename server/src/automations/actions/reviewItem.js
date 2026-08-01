// Action: create a Management Tasks card.
//
// The second and final approved action kind. An automation may DECIDE that a
// human should look at something; it still composes no message and sends
// nothing.
//
// Idempotent by construction: every card carries a dedupeKey derived from the
// submission, so a replayed automation or a re-submitted form returns the
// existing card instead of creating a second one. That holds even if the
// automation's own run-level idempotency were bypassed.

import { reviewItemsForTourSummary } from '../../reviewItems/fromTourSummary.js';

/**
 * `action.reviewKind` selects the builder. Today one builder covers both cards
 * a tour summary produces, because they are derived from the same submission
 * and must be created together or not at all.
 */
export async function createReviewItemAction(action, { def, event, refs, answers, db, log = console }) {
  const kind = action.reviewKind || 'tour_summary';
  try {
    if (kind !== 'tour_summary') {
      return { ok: false, error: `unsupported_review_kind:${kind}` };
    }
    const res = await reviewItemsForTourSummary({
      submission: event.submission,
      answers,
      refs,
      autId: def.id,
    }, db ? { db } : {});

    const parts = [];
    parts.push(res.summary?.created ? 'נוצר כרטיס סיכום סיור' : 'כרטיס סיכום סיור כבר קיים');
    if (res.logistics) {
      parts.push(res.logistics.created
        ? `נוצר דו״ח לוגיסטי (${res.findingCount} ממצאים)`
        : 'דו״ח לוגיסטי כבר קיים');
    } else {
      parts.push('אין ממצאים לוגיסטיים');
    }

    return {
      ok: true,
      ref: res.summary?.item?.id || null,
      detailHe: parts.join(' · '),
      created: [res.summary, res.logistics].filter((r) => r?.created).length,
    };
  } catch (err) {
    log.error?.(`[automations] review_item failed: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err).slice(0, 300) };
  }
}
