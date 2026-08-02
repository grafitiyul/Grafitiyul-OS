// AUT-002 — כרטיסי בקרה לסיכום סיור.
//
// EVERY submitted tour summary produces a review card in משימות הנהלה, plus a
// separate red logistics card when the summary reports a logistics problem.
//
// No `when` condition on purpose: this fires for every summary. The logistics
// card's own condition lives in the card builder (logisticsReport.js), because
// it is a per-answer rule over several questions rather than a single trigger
// condition — encoding it here would flatten six independent checks into one
// unreadable expression.
//
// The two cards are separate ReviewItem rows with separate dedupeKeys, so the
// office handles them independently.

import { registerAutomation } from '../registry.js';

// The LIVE tour-summary template. Template keys are auto-generated at
// creation (tpl_<hex>), so this is the real one, verified in production.
// The TRIGGER matches on PURPOSE, not on this key — the office decides which
// template serves 'tour_summary' — so rebuilding the form cannot stop the
// automation. The key is used only for the key-protection dependency check.
const TEMPLATE_KEY = 'tpl_2ff0ecd9';

const definition = {
  id: 'AUT-002',
  slug: 'tour_summary_review_cards',
  nameHe: 'כרטיסי בקרה לסיכום סיור',
  descriptionHe:
    'כל סיכום סיור שמוגש יוצר כרטיס לקריאה במשימות הנהלה. אם הסיכום מדווח על בעיה '
    + 'לוגיסטית (ניקיון, מלאי, ציוד או תקלה טכנית) נוצר בנוסף דו״ח לוגיסטי נפרד, '
    + 'שמטופל בנפרד מהסיכום.',
  category: 'tours',
  defaultEnabled: true,

  trigger: {
    kind: 'questionnaire_submitted',
    templateKey: TEMPLATE_KEY,
    purpose: 'tour_summary',
    firstSubmitOnly: true,
  },

  when: null, // every summary is reviewed

  // ONE action: create the cards. The manager NOTIFICATIONS that follow (#17
  // summary submitted, #19 payment left, #20 logistics) are code-defined
  // reports fired from the card builder itself — internal operational signals
  // do not belong in the Communication Center, which owns customer-facing
  // content. They fire after the cards exist, so their deep links resolve.
  actions: [
    { kind: 'review_item', reviewKind: 'tour_summary' },
  ],

  dependsOn: [
    { kind: 'questionnaire_template', templateKey: TEMPLATE_KEY, severity: 'hard' },
  ],

  idempotency: (ev) => `AUT-002:${ev.submissionId}`,

  notesHe:
    'התוכן מוקפא על הכרטיס ברגע היצירה — מדריך, לקוח, ארגון, מוצר, וריאציה, מועד '
    + 'והתשובות עצמן — כך שעריכה מאוחרת של השאלון, הדיל או הסיור לא משכתבת את מה '
    + 'שההנהלה כבר קראה. השאלות מזוהות לפי תפקיד (config.summaryRole / '
    + 'config.logisticsRole) ולא לפי מפתח קשיח, כדי שניסוח וסדר יישארו חופשיים. '
    + 'ההתראות עצמן הן דיווחי מנהלים המוגדרים בקוד (#17, #19, #20) ולא הודעות '
    + 'ממרכז התקשורת.',
};

registerAutomation(definition);
export default definition;
