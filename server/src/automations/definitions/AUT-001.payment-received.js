// AUT-001 — התקבל תשלום בסיכום סיור.
//
// When a guide reports in the tour summary that they received a payment, the
// office needs to know: which customer, how much is still outstanding, which
// guide took it, and when the tour was.
//
// ── What this file does and does NOT do ──────────────────────────────────────
// It DECIDES. It fires this automation's own Communication Center trigger and
// stops. The message itself — its wording, channel, recipients, timing and
// sending window — is configured in the Communication Center against the
// trigger "AUT-001 · התקבל תשלום בסיכום סיור", exactly like every other
// message in the system. Nothing here composes text or sends anything.
//
// ── The condition ────────────────────────────────────────────────────────────
// The payment question is `yesno`, whose stored value is a BOOLEAN (see
// questionnaires/types.js) — not an option key. So the condition compares to
// `true`; there is no option dependency to declare, because no option value is
// ever written into an answer for this type.
//
// The key below is the LIVE question, verified against production. If the
// question is ever deleted and recreated the key changes, and the registry will
// report this automation שבורה with the exact missing key — publish is also
// blocked by the questionnaire's own key guard, so it cannot happen silently.

import { registerAutomation } from '../registry.js';

// The live tour-summary template. The TRIGGER matches on PURPOSE (the office
// decides which template serves 'tour_summary'), so this key is used only for
// the key-protection dependency check.
const TEMPLATE_KEY = 'tpl_2ff0ecd9';
// "האם התקבל תשלום?" — yesno.
const PAYMENT_QUESTION_KEY = 'q_1aa409f5';

const definition = {
  id: 'AUT-001',
  slug: 'payment_received_in_summary',
  nameHe: 'התקבל תשלום בסיכום סיור',
  descriptionHe:
    'כשמדריך מדווח בסיכום הסיור שהתקבל תשלום — נשלחת הודעה למנהלים דרך מרכז התקשורת, '
    + 'עם הלקוח, היתרה לתשלום בדיל, המדריך שקיבל את התשלום ומועד הסיור.',
  category: 'tours',
  defaultEnabled: true,

  trigger: {
    kind: 'questionnaire_submitted',
    templateKey: TEMPLATE_KEY,
    purpose: 'tour_summary',
    // A guide editing their summary later is not a second payment.
    firstSubmitOnly: true,
    contexts: ['deal', 'contact', 'org', 'tour', 'payment'],
  },

  // Boolean, because `yesno` stores a boolean. Referenced by STABLE KEY, so
  // rewording the question changes nothing.
  when: { q: PAYMENT_QUESTION_KEY, op: 'eq', value: true },

  actions: [{ kind: 'communication' }],

  dependsOn: [
    { kind: 'questionnaire_template', templateKey: TEMPLATE_KEY, severity: 'hard' },
    { kind: 'questionnaire_question', templateKey: TEMPLATE_KEY, questionKey: PAYMENT_QUESTION_KEY, severity: 'hard' },
    { kind: 'communication_trigger', triggerType: 'automation:AUT-001' },
  ],

  // One notification per submitted summary. A re-submit reuses this key and is
  // dropped, so the office is never told twice about one payment.
  idempotency: (ev) => `AUT-001:${ev.submissionId}`,

  notesHe:
    'היתרה לתשלום מגיעה ממודול הגבייה (collection.js), שהוא מקור האמת היחיד לחישוב — '
    + 'לא מסכום הדיל. הודעה למנהלים בלבד; הלקוח אינו מקבל דבר מהאוטומציה הזו.',
};

registerAutomation(definition);
export default definition;
