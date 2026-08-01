// THE catalog of action kinds — the generic capability library automations
// compose from. Adding a CAPABILITY is an entry here plus an executor in
// actions/; adding an AUTOMATION is never new action code.
//
// This is the project's standing rule (capability before template): a new
// business need extends a generic capability, it never grows a one-off branch
// inside a definition.
//
// ── The hard boundary ────────────────────────────────────────────────────────
// Automations DECIDE. They never compose customer-facing content.
//   * customer-facing → 'communication' → the Communication Center owns the
//     text, the channel, the sending window and the operator's edits;
//   * internal        → 'admin_report'  → the code catalog owns the layout;
//   * anything else   → 'task'          → a human acts.
// This keeps the outbound SSOT intact and honours the standing rule that
// GOS-composed customer email is never sent without operator review.
//
// ── Retry ────────────────────────────────────────────────────────────────────
// The automation runner NEVER retries a decision — a failed decision is a bug
// or a data problem, and silently retrying hides both. Retry belongs to the
// TRANSPORT, and each kind below declares the transport that owns it, so the
// registry can show real retry behaviour instead of a guess.

export const ACTION_KINDS = {
  task: {
    kind: 'task',
    labelHe: 'יצירת משימה',
    // Which subsystem performs it — the registry links straight there.
    ownerModule: 'tasks',
    retryHe: 'אין ניסיון חוזר — יצירת משימה היא כתיבה מקומית שמצליחה או נכשלת מיידית.',
    // Config keys a definition may set for this kind (validated at boot).
    configKeys: ['taskTypeKey', 'titleHe', 'dueInDays', 'assignTo', 'priority'],
  },

  communication: {
    kind: 'communication',
    labelHe: 'הפעלת כלל תקשורת',
    ownerModule: 'communication',
    retryHe: 'מרכז התקשורת אחראי על המשלוח וניסיונות חוזרים (CommunicationDelivery).',
    // A definition declares only the TRIGGER TYPE. Which messages go out is
    // the Communication Center's decision, resolved live for the registry.
    configKeys: ['triggerType', 'triggerRef'],
  },

  admin_report: {
    kind: 'admin_report',
    labelHe: 'דיווח מנהלים',
    ownerModule: 'adminReports',
    retryHe: 'דיווחי מנהלים נשלחים מיידית ומנוסים שוב בגיבוי נסיגה (AdminReportDelivery).',
    configKeys: ['number', 'buildData'],
  },

  control_issue: {
    kind: 'control_issue',
    labelHe: 'פתיחת תקלה בבקרה',
    ownerModule: 'control',
    retryHe: 'אין ניסיון חוזר — התקלה נשארת פתוחה עד שהתנאי נעלם או שאדם מטפל בה.',
    configKeys: ['issueType', 'severity', 'titleHe', 'explanationHe', 'dedupeKey'],
  },

  timeline_note: {
    kind: 'timeline_note',
    labelHe: 'רישום ביומן הפעילות',
    ownerModule: 'timeline',
    retryHe: 'אין ניסיון חוזר — רישום מקומי בתוך אותה טרנזקציה.',
    configKeys: ['subjectType', 'bodyHe', 'kind'],
  },

  state_change: {
    kind: 'state_change',
    labelHe: 'שינוי מצב עסקי',
    ownerModule: 'domain',
    retryHe: 'אין ניסיון חוזר — השינוי הוא טרנזקציוני ואידמפוטנטי.',
    // The ONE escape hatch for adopting existing domain transitions
    // (completeTour, ensureTourPayroll, expireRegistration …). `handler` names
    // a whitelisted domain operation — never inline business logic.
    configKeys: ['handler', 'summaryHe'],
  },
};

export const ACTION_KIND_LIST = Object.values(ACTION_KINDS);

export function actionKind(kind) {
  return ACTION_KINDS[kind] || null;
}

export function isKnownActionKind(kind) {
  return Object.prototype.hasOwnProperty.call(ACTION_KINDS, kind);
}
