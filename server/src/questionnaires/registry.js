// Purpose Registry + Subject Adapter Registry (blueprint §4–§5).
//
// The engine itself knows NOTHING about Bookings or TourEvents. Everything
// subject-specific goes through a small adapter contract, keyed by
// subjectType. Adding a consumer (deal / organization / person_ref / contact
// / …) is a registry entry — never an engine change.
//
// Adapter contract (all optional except exists):
//   exists(subjectId)                → boolean — validate before bind/submit
//   displayContext(subjectId, lang)  → { title, subtitle?, ... } | null —
//                                      frozen onto submission.subjectSnapshot
//   prefill(subjectId, lang)         → { [questionKey]: value } — known values
//   resolveLanguage(subjectId)       → language code | null
//   authorize(subjectId, auth)       → boolean — staff-side access gate
//   onStarted(subjectId, submission, tx)   → side effects (timeline …)
//   onSubmitted(subjectId, submission, tx) → side effects (timeline …)
//
// This module is deliberately DB-free: adapters live in ./adapters/ and are
// registered by ./adapters/index.js, so pure logic stays unit-testable.

// tourOperational purposes follow the tour-operational lifecycle
// (lifecyclePolicy.js). TWO independent freeze concepts, both anchored on the
// tour's explicit completion (TourEvent.completedAt / cancelledAt):
//   • STRUCTURE FREEZE — at tour completion: the version pins (frozenAt) and
//     definition changes stop appearing.
//   • ANSWER LOCK — completion + answerLockGraceMs: answers become immutable.
// Coordination locks immediately; the tour summary keeps a post-completion
// edit window (guides remember details the next day).

// The ONE configurable constant for the tour summary's post-completion window.
export const SUMMARY_POST_COMPLETION_EDIT_MS = 48 * 60 * 60 * 1000;

const PURPOSES = {
  // Guide debrief after a tour — PER-GUIDE: every required guide (lead_guide /
  // guide) files their OWN summary; actorScope (the guide's externalPersonId)
  // joins the singleton key. Tour completion condition #1 counts these.
  tour_summary: {
    key: 'tour_summary',
    labelHe: 'סיכום סיור',
    subjectTypes: ['tour_event'],
    audience: 'staff',
    singleton: true,
    perActor: true,
    tourOperational: true,
    // ONE LIVE FORM. See liveEdit below.
    liveEdit: true,
    answerLockGraceMs: SUMMARY_POST_COMPLETION_EDIT_MS,
    // Primary action: first press officially submits; later presses save a
    // meaningful update (one history entry each).
    submitLabels: { first: 'שלח סיכום סיור', update: 'שמור עדכון' },
  },
  // Internal coordination-call form — one active submission per Booking.
  // Staff-only BY PRODUCT DECISION: the operator/guide fills it during the
  // coordination call. No customer links, no public fill surface.
  coordination: {
    key: 'coordination',
    labelHe: 'שיחת תיאום',
    subjectTypes: ['booking'],
    audience: 'staff',
    singleton: true,
    tourOperational: true,
    liveEdit: true,
    answerLockGraceMs: 0,
    submitLabels: { first: 'בוצעה שיחת תיאום', update: 'שמור עדכון' },
  },
  // Unbound generic questionnaires (surveys, internal forms). No subject
  // required; multiple submissions allowed.
  general: {
    key: 'general',
    labelHe: 'כללי',
    subjectTypes: [],
    allowUnbound: true,
    audience: 'both',
    singleton: false,
  },
};

// ── liveEdit: one live form, no version chrome ───────────────────────────────
// For the two OPERATIONAL questionnaires the office maintains itself, versions
// are pure overhead: nobody wants to think about drafts, publishing or version
// numbers to fix a typo in a question.
//
// This is safe because version immutability is NOT what protects history —
// the per-answer questionSnapshot is. Every submitted answer freezes its own
// question text, type, options, help text and section title at submit time, and
// renderSubmissionAnswers is built from those snapshots ONLY, never from the
// live version tree. A submitted summary therefore reads exactly as it did the
// day it was filed, no matter how the questionnaire changes afterwards.
//
// What versions still do, and still do here:
//   * pin the structure an IN-FLIGHT draft is being filled against;
//   * keep the historical version rows that old submissions point at.
// Both keep working — liveEdit only removes the requirement to create a NEW
// version in order to change the live one.
//
// The generic engine is untouched: any other questionnaire keeps the full
// draft → publish lifecycle.
export function purposeAllowsLiveEdit(key) {
  return !!PURPOSES[key]?.liveEdit;
}

export function getPurpose(key) {
  return PURPOSES[key] || null;
}

export function listPurposes() {
  return Object.values(PURPOSES);
}

export function isValidPurpose(key) {
  return Object.prototype.hasOwnProperty.call(PURPOSES, key);
}

// purpose + subjectType binding legality (blueprint §5). Unbound submissions
// (subjectType null) are legal only for purposes that opt in.
export function purposeAllowsSubject(purposeKey, subjectType) {
  const p = getPurpose(purposeKey);
  if (!p) return false;
  if (!subjectType) return !!p.allowUnbound;
  return p.subjectTypes.includes(subjectType);
}

const adapters = new Map();

export function registerSubjectAdapter(subjectType, adapter) {
  if (!subjectType || typeof adapter?.exists !== 'function') {
    throw new Error(`subject adapter for "${subjectType}" must implement exists()`);
  }
  adapters.set(subjectType, { subjectType, ...adapter });
}

export function getSubjectAdapter(subjectType) {
  return adapters.get(subjectType) || null;
}

export function listSubjectTypes() {
  return [...adapters.keys()];
}
