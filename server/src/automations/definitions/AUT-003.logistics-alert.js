// AUT-003 — דו״ח לוגיסטי בסיכום סיור.
//
// Fires when a tour summary reports a logistics problem, so the logistics owner
// hears about it immediately rather than at the next digest.
//
// ── Why the condition is here AND in the card builder ────────────────────────
// They answer different questions and are deliberately not shared:
//
//   HERE       "is there anything at all to tell someone about?" — one boolean,
//              expressed over stable keys, used to decide whether to notify.
//   CARD       "which specific findings, with their values?" — the detail a
//              manager reads (reviewItems/kinds/logisticsReport.js).
//
// Collapsing them would mean either a notification with no detail, or a card
// builder that decides who gets messaged. The keys below are the SAME live
// questions the card roles map to, so the two can never disagree about what
// counts as a problem.
//
// The message itself lives in the Communication Center on trigger
// "AUT-003 · דו״ח לוגיסטי" — channel, recipients, wording and window included.

import { registerAutomation } from '../registry.js';

const TEMPLATE_KEY = 'tpl_2ff0ecd9';

// The live logistics questions. yesno stores a BOOLEAN; the two free-text ones
// signal by simply being answered.
const STUDIO_DIRTY = 'q_3dbca68c';
const STENCIL_DISCARDED = 'q_be3b2a39';
const VINYL_LOW = 'q_11de4919';
const NEW_SPRAY_CAN = 'q_9c7d49f9';      // free text
const EQUIPMENT_OR_TECHNICAL = 'q_75132af1'; // free text

const definition = {
  id: 'AUT-003',
  slug: 'logistics_alert',
  nameHe: 'דו״ח לוגיסטי בסיכום סיור',
  descriptionHe:
    'כשסיכום סיור מדווח על בעיה לוגיסטית — סטודיו מלוכלך, שבלונה שנזרקה, מלאי תקליטים '
    + 'שעומד להיגמר, ספריי חדש שנפתח, או חוסר בציוד / תקלה טכנית — נשלחת הודעה לאחראית '
    + 'הלוגיסטיקה דרך מרכז התקשורת. הכרטיס עצמו נוצר במקביל במשימות הנהלה.',
  category: 'tours',
  defaultEnabled: true,

  trigger: {
    kind: 'questionnaire_submitted',
    templateKey: TEMPLATE_KEY,
    purpose: 'tour_summary',
    firstSubmitOnly: true,
    contexts: ['deal', 'contact', 'org', 'tour'],
  },

  // ANY logistics answer that needs attention. Stable keys only — rewording or
  // reordering the questions changes nothing.
  when: {
    any: [
      { q: STUDIO_DIRTY, op: 'eq', value: true },
      { q: STENCIL_DISCARDED, op: 'eq', value: true },
      { q: VINYL_LOW, op: 'eq', value: true },
      { q: NEW_SPRAY_CAN, op: 'answered' },
      { q: EQUIPMENT_OR_TECHNICAL, op: 'answered' },
    ],
  },

  actions: [{ kind: 'communication' }],

  dependsOn: [
    { kind: 'questionnaire_template', templateKey: TEMPLATE_KEY, severity: 'hard' },
    ...[STUDIO_DIRTY, STENCIL_DISCARDED, VINYL_LOW, NEW_SPRAY_CAN, EQUIPMENT_OR_TECHNICAL].map(
      (questionKey) => ({ kind: 'questionnaire_question', templateKey: TEMPLATE_KEY, questionKey, severity: 'hard' }),
    ),
    { kind: 'communication_trigger', triggerType: 'automation:AUT-003' },
  ],

  idempotency: (ev) => `AUT-003:${ev.submissionId}`,

  notesHe:
    'ההודעה מתריעה שיש בעיה; הפירוט המלא — אילו ממצאים ומה נכתב בהם — נמצא בכרטיס '
    + 'הלוגיסטי במשימות הנהלה, שנוצר על ידי AUT-002. הכרטיס מטופל בנפרד מכרטיס '
    + 'סיכום הסיור.',
};

registerAutomation(definition);
export default definition;
