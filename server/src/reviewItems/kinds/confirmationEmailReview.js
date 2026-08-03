// Review card: a deal became WON while carrying special terms (fillers), so
// its confirmation email must be read by a person before it goes out.
//
// The case this exists for: WON can happen with nobody looking at the Deal —
// an iCount IPN, a Cardcom callback, a worker. When the deal has NO fillers
// the email is standard and is sent automatically. When it HAS fillers the
// email contains agreed exceptions (a changed cancellation policy, a new
// guide, a shortened activity), and the three alternatives are all wrong —
//
//   send it blindly        → a customer receives negotiated terms nobody
//                            re-read, in an email we cannot unsend.
//   send nothing, silently → the office believes the customer was confirmed.
//   pop a modal from a
//   webhook                → impossible; there is no browser to open.
//
// So it becomes a card: the email is composed and waiting, and a person opens
// the Deal, reviews the preview and sends. Sending resolves the card.

import { registerReviewKind } from '../registry.js';

export const CONFIRMATION_EMAIL_REVIEW_KIND = 'confirmation_email_review';

registerReviewKind(CONFIRMATION_EMAIL_REVIEW_KIND, {
  labelHe: 'מייל אישור ממתין לאישור',
  tone: 'alert',
  descriptionHe:
    'נוצר כשעסקה נסגרה (WON) ויש לה תנאי עסקה מיוחדים (פילרים). '
    + 'מייל האישור לא נשלח אוטומטית — צריך לפתוח תצוגה מקדימה, לבדוק ולשלוח.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.orderNo || item.dealId}` : null),
});
