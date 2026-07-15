// Migration Review Center — queue registry (TEMPORARY, one-time migration tool).
//
// This is NOT a generic review platform: it is the fixed set of queues this one
// migration needs. The whole Review Center (this dir + routes/migrationReview.js
// + client/src/admin/migration) is deleted after cutover. MigrationDecision and
// LegacyRecord are the permanent parts and stay.
//
// Tab order here IS the approved information architecture:
//   Organizations · Contacts · Name cleanup · Stage & configuration ·
//   Exceptional records · Legacy archive
// Units live INSIDE the Organizations workflow (no Units tab); phone evidence
// lives INSIDE the Contacts duplicate flow (no phone tab).

export const REVIEW_QUEUES = [
  {
    key: 'organizations',
    label: 'ארגונים',
    kind: 'queue',
    blocking: true,
    implemented: true,
    summary: 'איחוד ארגונים כפולים ויצירת סניפים (יחידות), לפי ראיות מהצילום.',
  },
  {
    key: 'contacts',
    label: 'אנשי קשר',
    kind: 'queue',
    blocking: true,
    implemented: false,
    summary: 'איחוד אנשי קשר כפולים, כולל ראיות טלפון — נבנה בשלב הבא.',
  },
  {
    key: 'name_cleanup',
    label: 'ניקוי שמות',
    kind: 'queue',
    blocking: true,
    implemented: false,
    summary: 'שמות חסרים או לא תקינים לאישור ידני — נבנה בשלב הבא.',
  },
  {
    key: 'stage_config',
    label: 'שלבים והגדרות',
    kind: 'queue',
    blocking: true,
    implemented: true,
    summary: 'ההחלטות המאושרות של המיגרציה — לצפייה בלבד.',
  },
  {
    key: 'exceptional',
    label: 'רשומות חריגות',
    kind: 'queue',
    blocking: false,
    implemented: false,
    summary: 'רשומות שדורשות החלטה פרטנית — נבנה בשלב הבא.',
  },
  {
    key: 'legacy_archive',
    label: 'ארכיון מערכת קודמת',
    kind: 'browser',
    blocking: false,
    implemented: true,
    summary: 'עיון לקריאה בלבד ברשומות המקור מתוך הצילום. אין כאן החלטות.',
  },
];

export const QUEUE_KEYS = REVIEW_QUEUES.map((q) => q.key);
export const queueByKey = (key) => REVIEW_QUEUES.find((q) => q.key === key) || null;

// Frozen queues are owner-approved specification — the Center renders them
// read-only and the API refuses to re-decide them.
export const FROZEN_QUEUES = new Set(['stage_config']);

// A decision is resolved once it is no longer awaiting a human.
// `deferred` is deliberately NOT resolved — deferring parks an item for later, so
// the blocking gate must stay closed while any deferred item remains.
export const RESOLVED_STATUSES = new Set(['approved', 'rejected', 'edited']);
export const UNRESOLVED_STATUSES = new Set(['pending', 'deferred']);
export const isResolved = (status) => RESOLVED_STATUSES.has(String(status || ''));
