// ── THE canonical answer to "what activity is this deal?" ───────────────────
//
// Before this module the rule "a linked organization means business" was
// re-derived, independently and by hand, in SEVEN places:
//
//   server/src/communication/conditions.js      (message targeting)
//   server/src/communication/variables.js       (the activity variable)
//   server/src/confirmation/resolveTemplate.js  (WHICH confirmation email)
//   server/src/confirmation/variables.js        (the activity variable)
//   server/src/ingress/records.js               (×2 — create + order update)
//   server/src/deals/resolveActivityType.js     (the null-resolution ladder)
//   client/src/admin/deals/DealDetail.jsx       (the disabled buttons)
//
// Seven copies of one rule is seven places to disagree, and they already did:
// six of them treated a linked organization as an OVERRIDE that outranks the
// deal's own value, while resolveActivityType treated it as a DEFAULT that
// only applies when nobody chose. This module is the one ladder, and the
// DEFAULT reading is the correct one.
//
// ── The model ───────────────────────────────────────────────────────────────
//
// `Deal.activityType` and `Deal.organizationId` answer two different questions
// and were being conflated:
//
//   activityType   — WHAT IS BEING DELIVERED. An operational classification;
//                    it becomes TourEvent.kind. (private experience /
//                    business event / a seat on an open tour)
//   organizationId — WHO THE COUNTERPARTY IS. A commercial/billing fact.
//
// A company can book a private family-style experience. A company can buy two
// seats on an open tour. Reading "an organization is attached" as "the activity
// is a business event" makes both of those impossible to express, and — worse —
// silently picks the BUSINESS confirmation email template for a private tour.
//
// So: an explicit activity type is authoritative and is never overridden.
// A linked organization only answers for a deal that has no answer of its own.
//
// ── What did NOT change ─────────────────────────────────────────────────────
//
// The ORGANIZATION TYPE half of the classification SSOT is untouched: a linked
// organization's own type is still the deal's effective type, the deal-level
// copy is still force-cleared, and a subtype must still belong to the effective
// type (server/src/deals/classification.js). That rule was always about *type*,
// never about *activity*, and it stays exactly as it was.
//
// Collection's `customerKind` (server/src/collection.js) also deliberately
// keeps its own `organizationId || activityType === 'business'` reading. It
// asks a THIRD question — "is there a company to invoice?" — which really is
// answered by the org link alone. It is not a copy of this rule.

/** The Deal.activityType vocabulary. TourEvent.kind maps group → group_slot. */
export const ACTIVITY_TYPES = ['group', 'private', 'business'];

/** Deal.activityType → TourEvent.kind. */
export const ACTIVITY_TO_TOUR_KIND = Object.freeze({
  group: 'group_slot',
  private: 'private',
  business: 'business',
});

/** TourEvent.kind → Deal.activityType (the inverse; guide portal uses it too). */
export const TOUR_KIND_TO_ACTIVITY = Object.freeze({
  group_slot: 'group',
  private: 'private',
  business: 'business',
});

export const ACTIVITY_TYPE_LABELS_HE = Object.freeze({
  group: 'קבוצתי',
  private: 'פרטי',
  business: 'עסקי',
});

/**
 * The deal's EFFECTIVE activity type — the ONE read every consumer uses.
 *
 *   1. an explicit `Deal.activityType` is authoritative, always;
 *   2. otherwise a linked organization means business;
 *   3. otherwise null — genuinely unknown.
 *
 * Null-preserving on purpose: a reader that matches templates or evaluates
 * message conditions must be able to tell "unknown" from "private". The
 * WRITE-side resolver (server/src/deals/resolveActivityType.js) is the one that
 * commits to a value, because persisting a null is its own bug — it layers the
 * group-slot signal and a residual `private` onto this same ladder.
 *
 * Accepts any object carrying `activityType` / `organizationId` (a Prisma row,
 * a client deal DTO, a merged patch).
 */
export function effectiveActivityType(deal) {
  if (deal?.activityType) return deal.activityType;
  if (deal?.organizationId) return 'business';
  return null;
}

// ── Deal.activityType ⇄ TourEvent.kind COMPATIBILITY ────────────────────────
//
// THE one resolver for "may this deal sit on this tour?". Every consumer asks
// here rather than comparing raw enum values, because the question is
// OPERATIONAL, not lexical: what actually differs between the two sides is the
// seat model (a slot has capacity, shared stock and a Woo variation; a
// dedicated tour has none of those), and `private` vs `business` differs in
// nothing but a label.
//
// That asymmetry is why the pair (deal, tour) needs a resolver and not an
// equality check — and it is exactly what a first production sweep showed:
// 6 of 9 real mismatches were business-deal-on-private-tour (cosmetic), 3 were
// group-deal-on-dedicated-tour (genuinely incoherent).

/** Is the deal's activity type operationally compatible with the tour's kind? */
export function isActivityTourCompatible(activityType, tourKind) {
  if (!activityType || !tourKind) return true; // unknown ⇒ never asserted about
  const expected = ACTIVITY_TO_TOUR_KIND[activityType];
  if (!expected) return true; // an unmapped future type is not asserted about
  return expected === tourKind;
}

/**
 * The full compatibility verdict — what is wrong, how badly, and which side
 * would have to move to fix it.
 *
 *   compatible   nothing to do
 *   severity     'critical' when a group slot is involved (seats, capacity,
 *                shared stock and open-tour reporting all disagree about what
 *                is being sold) · 'warning' for private↔business (a label on
 *                the calendar and in the guide portal; nothing operational
 *                differs, which is why the conversion service relabels that
 *                tour in place instead of replacing it)
 *   structural   does fixing it move seats/bookings, or is it a relabel?
 *   dealTarget   the activity type the DEAL would become if the TOUR is right
 *   tourTarget   the activity type to convert TO if the DEAL is right (the
 *                operational side moves to match it)
 */
export function activityTourCompatibility(activityType, tourKind) {
  const compatible = isActivityTourCompatible(activityType, tourKind);
  if (compatible) {
    return { compatible: true, severity: null, structural: false, dealTarget: null, tourTarget: null };
  }
  const involvesGroup = activityType === 'group' || tourKind === 'group_slot';
  return {
    compatible: false,
    severity: involvesGroup ? 'critical' : 'warning',
    // A group slot on either side means real seats have to move; private↔business
    // is a relabel of the same TourEvent.
    structural: involvesGroup,
    dealTarget: TOUR_KIND_TO_ACTIVITY[tourKind] || null,
    tourTarget: activityType,
  };
}

/**
 * Does this deal carry a combination an operator had to choose deliberately —
 * a linked organization on a non-business activity?
 *
 * Not a warning and not an error: it is a legitimate, explicitly-chosen state
 * (a company booking a private experience). Surfaces exist only to EXPLAIN it,
 * so nobody reads it as data corruption.
 */
export function hasDeliberateOrgActivityMix(deal) {
  const t = deal?.activityType;
  return !!deal?.organizationId && !!t && t !== 'business';
}
