// Review card: a coordination follow-up could not be carried out.
//
// The case this exists for: a guide ticks "send them the meeting point" and, by
// the time the form is submitted, the variant or location has no meeting-point
// content. There are three ways to handle that and only one is honest —
//
//   send an empty message      → the customer gets "היי, הנה שוב נקודת המפגש:"
//                                and nothing. Worse than saying nothing.
//   record a failed delivery   → the queue fills with failures for a
//                                configuration that was never eligible, and a
//                                real provider failure hides among them.
//   say nothing at all         → the guide believes the customer was told.
//
// So it becomes a card: somebody asked for something the system could not do,
// and a person needs to either send it manually or fill in the content.

import { registerReviewKind } from '../registry.js';

export const COORDINATION_ISSUE_KIND = 'coordination_issue';

registerReviewKind(COORDINATION_ISSUE_KIND, {
  labelHe: 'תקלה בשיחת תיאום',
  tone: 'alert',
  descriptionHe:
    'נוצר כשמדריך ביקש בשיחת תיאום לשלוח משהו ללקוח ולא היה תוכן קנוני לשלוח. '
    + 'לא נשלחה הודעה ריקה ולא נרשמה שליחה שנכשלה.',
  buildLink: (item) => (item.tourEventId ? `/admin/tours/${item.tourEventId}` : null),
});
