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
// `when` is deliberately empty in code and the real condition lives in
// `dependsOn`: the payment question is identified by its STABLE KEY, which the
// office maps once in the questionnaire builder. Until that mapping exists the
// automation reports itself as שבורה in the registry with the exact missing
// key, which is the honest state — better than silently matching nothing.
//
// To finish wiring this automation:
//   1. In the tour summary questionnaire, open the payment question and copy
//      its stable key (the automation panel shows it).
//   2. Replace PAYMENT_QUESTION_KEY / PAYMENT_YES_OPTION below.
//   3. Create a Communication Center event on the AUT-001 trigger.
//
// The registry's dependency panel walks an operator through exactly this.

import { registerAutomation } from '../registry.js';

// The office maps these once. They are the ONLY template-specific values in
// this file, and they are keys — never question or answer wording.
// The LIVE tour-summary template. Template keys are auto-generated at
// creation (tpl_<hex>), so this is the real one, verified in production.
// The TRIGGER matches on PURPOSE, not on this key — the office decides which
// template serves 'tour_summary' — so rebuilding the form cannot stop the
// automation. The key is used only for the key-protection dependency check.
const TEMPLATE_KEY = 'tpl_2ff0ecd9';
const PAYMENT_QUESTION_KEY = null; // e.g. 'q_9f3a12bd'
const PAYMENT_YES_OPTION = null;   // e.g. 'o_7c21ab90'

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

  // Stable keys only. Null until the office maps the question, which the
  // registry surfaces as a broken dependency rather than a silent no-op.
  when: PAYMENT_QUESTION_KEY && PAYMENT_YES_OPTION
    ? { q: PAYMENT_QUESTION_KEY, op: 'eq', value: PAYMENT_YES_OPTION }
    : null,

  actions: [{ kind: 'communication' }],

  dependsOn: [
    { kind: 'questionnaire_template', templateKey: TEMPLATE_KEY, severity: 'hard' },
    ...(PAYMENT_QUESTION_KEY
      ? [{ kind: 'questionnaire_question', templateKey: TEMPLATE_KEY, questionKey: PAYMENT_QUESTION_KEY, severity: 'hard' }]
      : []),
    ...(PAYMENT_QUESTION_KEY && PAYMENT_YES_OPTION
      ? [{
        kind: 'questionnaire_option',
        templateKey: TEMPLATE_KEY,
        questionKey: PAYMENT_QUESTION_KEY,
        optionValue: PAYMENT_YES_OPTION,
        severity: 'hard',
      }]
      : []),
    { kind: 'communication_trigger', triggerType: 'automation:AUT-001' },
  ],

  // One notification per submitted summary. A re-submit reuses this key and is
  // dropped, so the office is never told twice about one payment.
  idempotency: (ev) => `AUT-001:${ev.submissionId}`,

  notesHe:
    'היתרה לתשלום מגיעה ממודול הגבייה (collection.js), שהוא מקור האמת היחיד לחישוב — '
    + 'לא מסכום הדיל. הודעה למנהלים בלבד; הלקוח אינו מקבל דבר מהאוטומציה הזו. '
    + 'כל עוד שאלת התשלום לא מופתה במרשם, האוטומציה תוצג כשבורה עם המפתח החסר.',
};

registerAutomation(definition);
export default definition;
