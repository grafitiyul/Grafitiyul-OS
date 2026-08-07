// ONE place that turns a confirmation-send API response into operator wording.
// Every surface that queues a confirmation email (Deal card, preview modal, WON
// recovery, tour-update resend) uses this, so they can never drift apart.
//
// THE RULE (deals #27099/#27100): the toast reports the CANONICAL delivery
// state and never predicts. "נשלח" is reserved for a delivery Gmail has
// actually accepted. Queuing gets "נוסף לתור השליחה" — accurate at the instant
// it is shown, and the Deal's delivery chip carries the outcome from there.

import { queuedToastHe } from '../../../lib/emailDelivery.js';

const timeHe = (iso) =>
  new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

/**
 * @param {object} res  the POST /send response ({ delivery, windowHold })
 * @param {string} [prefix] optional lead for compound actions
 *        (e.g. 'הסיור נוצר') — the delivery sentence still owns the truth.
 * → { title, detail }
 */
export function confirmationQueuedToast(res, prefix = null) {
  const delivery = res?.delivery || null;
  const base = queuedToastHe(delivery);

  // The pre-send window advisory: the queue row exists but the worker will hold
  // it until the customer sending window opens. Known at queue time, so say so
  // rather than letting the operator expect it within the minute.
  const hold = res?.windowHold || null;
  const detail = hold
    ? hold.nextAt
      ? `מחוץ לחלון השליחה — יישלח בפתיחת החלון: ${timeHe(hold.nextAt)}`
      : 'מחוץ לחלון השליחה — יישלח בפתיחת החלון'
    : base.detail;

  const title = prefix ? `${prefix} — ${base.title}` : base.title;
  return { title, detail };
}
