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

const PURPOSES = {
  // Staff debrief after a tour — one active submission per TourEvent.
  tour_summary: {
    key: 'tour_summary',
    labelHe: 'סיכום סיור',
    subjectTypes: ['tour_event'],
    audience: 'staff',
    singleton: true,
  },
  // Customer coordination form — one active submission per Booking.
  coordination: {
    key: 'coordination',
    labelHe: 'שיחת תיאום',
    subjectTypes: ['booking'],
    audience: 'public',
    singleton: true,
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
