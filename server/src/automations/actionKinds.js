// THE catalog of action kinds — the complete, deliberately narrow list of things
// an automation may do.
//
// ── The scope boundary (approved 2026-08-01) ─────────────────────────────────
// TWO kinds. That is the whole vocabulary:
//
//   'communication' — invoke an existing Communication Center rule
//   'review_item'   — create a card in Management Tasks for a human to review
//
// This is not a starting point to grow from. An earlier draft of this module
// carried six kinds (task / admin_report / control_issue / timeline_note /
// state_change) whose only purpose was migrating existing GOS behaviour into a
// general automation engine. That programme was explicitly declined: coordination
// reports, tour completion, payroll hooks and the background workers stay owned
// by their current modules. Re-adding an action kind needs a new decision, not a
// convenient moment.
//
// ── The hard rule ────────────────────────────────────────────────────────────
// Automations DECIDE; they never compose customer-facing content and never send.
// The Communication Center owns every outbound message — its text, channel,
// audience, timing, sending window, versioning and delivery log. An automation
// only says "this happened, fire your rule".
//
// ── Retry ────────────────────────────────────────────────────────────────────
// The runner NEVER retries a decision: a failed decision is a bug or a data
// problem, and silently retrying hides both. Retry belongs to the transport, so
// each kind names the subsystem that actually owns it.

export const ACTION_KINDS = {
  communication: {
    kind: 'communication',
    labelHe: 'הפעלת כלל תקשורת',
    ownerModule: 'communication',
    ownerLabelHe: 'מרכז התקשורת',
    ownerLink: '/admin/settings/communication',
    retryHe: 'מרכז התקשורת אחראי על המשלוח, חלונות השליחה וניסיונות חוזרים (CommunicationDelivery).',
    // A definition declares ONLY its own automation trigger type. Which messages
    // go out, to whom, on which channel and when is the Communication Center's
    // decision — resolved live for the registry, never copied into the definition.
    configKeys: [],
  },

  review_item: {
    kind: 'review_item',
    labelHe: 'יצירת כרטיס למשימות הנהלה',
    ownerModule: 'reviewItems',
    ownerLabelHe: 'משימות הנהלה',
    ownerLink: '/admin/management-tasks',
    retryHe: 'אין ניסיון חוזר — יצירת הכרטיס אידמפוטנטית לפי dedupeKey, וכרטיס קיים לא נוצר פעמיים.',
    configKeys: ['reviewKind'],
  },
};

export const ACTION_KIND_LIST = Object.values(ACTION_KINDS);

export function actionKind(kind) {
  return ACTION_KINDS[kind] || null;
}

export function isKnownActionKind(kind) {
  return Object.prototype.hasOwnProperty.call(ACTION_KINDS, kind);
}
