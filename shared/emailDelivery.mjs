// THE canonical delivery state for every outgoing email in GOS.
//
// ONE vocabulary, ONE derivation, ONE set of labels. The timeline, the בקרה
// detectors, the review cards, the toasts, the send archive, the scheduled-email
// management view and every future module MUST read a delivery through here.
// No surface is allowed to invent its own reading of ScheduledEmail.status.
//
// WHY THIS EXISTS (deals #27099/#27100, 2026-08-07): the queue row said
// 'failed', while the Deal timeline said "נשלח מייל", the toast promised
// "יישלח תוך כדקה" and the בקרה card auto-resolved the moment a new row was
// queued. Four surfaces, four different answers, none of them the truth. The
// customer was never told her tours were confirmed.
//
// THE INVARIANT: only 'sent' means the message reached Gmail. Nothing else may
// be rendered, summarised or resolved as success.

/** The five canonical states. Nothing outside this list is a delivery state. */
export const DELIVERY_STATES = ['queued', 'sending', 'sent', 'failed', 'cancelled'];

/**
 * Map a stored ScheduledEmail row onto the canonical vocabulary.
 *  • DB 'pending' + an active claim  → 'sending' (a worker holds it right now)
 *  • DB 'pending' + no claim         → 'queued'
 *  • everything else is already canonical
 * The DB column deliberately keeps its historical 'pending' value — renaming it
 * would rewrite live rows for a naming preference. This function is the ONE
 * place the two vocabularies meet.
 */
export function canonicalDeliveryState(status, { claimedAt = null } = {}) {
  const s = String(status || '').trim();
  if (s === 'pending') return claimedAt ? 'sending' : 'queued';
  return DELIVERY_STATES.includes(s) ? s : 'queued';
}

/** Did the message actually reach the provider? The ONLY success test. */
export function isDelivered(state) {
  return state === 'sent';
}

/** No further attempt will happen on its own. */
export function isTerminal(state) {
  return state === 'sent' || state === 'failed' || state === 'cancelled';
}

/** Still on its way — the operator should not be told anything final yet. */
export function isInFlight(state) {
  return state === 'queued' || state === 'sending';
}

/** Needs a human: it will never arrive unless someone acts. */
export function needsAttention(state) {
  return state === 'failed';
}

export const DELIVERY_LABEL_HE = {
  queued: 'בתור השליחה',
  sending: 'נשלח כעת',
  sent: 'נשלח',
  failed: 'נכשל',
  cancelled: 'בוטל',
};

export const DELIVERY_LABEL_EN = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Tailwind chip tones, so every surface renders the same state identically. */
export const DELIVERY_TONE = {
  queued: 'bg-amber-50 text-amber-800 ring-amber-200',
  sending: 'bg-blue-50 text-blue-700 ring-blue-200',
  sent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-gray-100 text-gray-600 ring-gray-200',
};

/**
 * Build the canonical delivery object from a ScheduledEmail row.
 * Accepts the row shape returned by DELIVERY_SELECT (server/src/email/
 * deliveryState.js); tolerates a partial row so callers can pass a lean select.
 *
 * → { state, labelHe, labelEn, tone, delivered, terminal, inFlight,
 *     sentAt, failureReason, attemptCount, waitReason, effectiveAt,
 *     nextRetryAt, connectionDeferred, gmailMessageId }
 */
export function deliveryFromScheduledEmail(row) {
  if (!row) return null;
  const state = canonicalDeliveryState(row.status, { claimedAt: row.claimedAt });
  return {
    state,
    labelHe: DELIVERY_LABEL_HE[state],
    labelEn: DELIVERY_LABEL_EN[state],
    tone: DELIVERY_TONE[state],
    delivered: isDelivered(state),
    terminal: isTerminal(state),
    inFlight: isInFlight(state),
    sentAt: row.sentAt ?? null,
    failureReason: row.failureReason ?? null,
    attemptCount: row.attemptCount ?? 0,
    // Held for a customer sending window — queued, but for a KNOWN reason.
    waitReason: row.waitReason ?? null,
    effectiveAt: row.effectiveAt ?? null,
    nextRetryAt: row.nextRetryAt ?? null,
    connectionDeferred: (row.connectionDeferredCount ?? 0) > 0,
    gmailMessageId: row.gmailMessageId ?? null,
    scheduledEmailId: row.id ?? null,
  };
}

/**
 * A delivery that has no queue row at all. An immediate send (POST /send) mails
 * through Gmail synchronously and only ever mirrors an EmailMessage, so its
 * existence IS the delivery proof.
 */
export function deliveryForImmediateSend({ gmailMessageId = null, sentAt = null } = {}) {
  const state = gmailMessageId ? 'sent' : 'queued';
  return {
    ...deliveryFromScheduledEmail({ status: state, sentAt, gmailMessageId }),
    immediate: true,
  };
}

/**
 * ONE truthful Hebrew sentence for any delivery — the wording every toast,
 * chip tooltip and card explanation uses. Never promises what has not happened.
 */
export function deliverySummaryHe(delivery) {
  if (!delivery) return 'אין מידע על השליחה';
  const { state, failureReason, waitReason, effectiveAt, connectionDeferred } = delivery;
  if (state === 'sent') return 'המייל נשלח';
  if (state === 'cancelled') return 'השליחה בוטלה — המייל לא נשלח';
  if (state === 'failed') {
    return failureReason
      ? `השליחה נכשלה — הלקוח לא קיבל את המייל. סיבה: ${failureReason}`
      : 'השליחה נכשלה — הלקוח לא קיבל את המייל';
  }
  if (state === 'sending') return 'המייל נשלח כעת';
  // queued
  if (connectionDeferred) return 'המייל ממתין בתור — החיבור ל-Google אינו תקין';
  if (waitReason) {
    const at = effectiveAt ? new Date(effectiveAt) : null;
    return at
      ? `המייל ממתין בתור — מחוץ לחלון השליחה. יישלח ב-${at.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
      : 'המייל ממתין בתור — מחוץ לחלון השליחה';
  }
  return 'המייל נוסף לתור השליחה — טרם נשלח';
}

/** Toast title + detail for the moment a send is accepted. Never says "נשלח". */
export function queuedToastHe(delivery) {
  const summary = deliverySummaryHe(delivery);
  if (delivery?.state === 'sent') return { title: 'המייל נשלח', detail: null };
  if (delivery?.waitReason) return { title: 'המייל נוסף לתור השליחה', detail: summary };
  return {
    title: 'המייל נוסף לתור השליחה',
    detail: 'נעדכן כאן כשהשליחה תאושר מול Gmail',
  };
}
