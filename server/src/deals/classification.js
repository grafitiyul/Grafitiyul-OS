// Deal classification — the ONE reconciliation rule between a Deal's
// activity/org-type fields and its linked Organization.
//
// Business rule (SSOT):
//   • ORGANIZATION TYPE (unchanged, and the strong half of the rule):
//     the Organization's own type is the deal's effective organization type —
//     Deal.organizationTypeId is force-cleared so no contradicting copy can
//     ever be persisted next to a linked org. Manual selection is only
//     authoritative while NO organization is linked.
//   • The subtype stays deal-owned, but must belong to the effective type:
//     a subtype scoped to a different type is cleared on org attach/change
//     (generic, type-less subtypes always survive).
//   • ACTIVITY TYPE: an Organization ANSWERS for a deal that has no answer of
//     its own. It never overwrites one. See below.
//   • No organization → the deal owns all three fields (manual selection).
//
// ── Why activity type is a default and not an override ──────────────────────
//
// This used to force activityType='business' on every single save of an
// org-linked deal. That made two real bookings inexpressible — a company
// booking a private family-style experience, and a company buying seats on an
// open tour — because the value was silently rewritten on the next unrelated
// save. It also made the "convert activity type" flow impossible in the
// business → private/group direction: the operator's explicit choice could not
// survive a round-trip.
//
// The corrected rule is one line, and it is deliberately the SAME line the
// reader side uses (shared/dealActivity.mjs, effectiveActivityType):
//
//   an explicit activity type is authoritative;
//   an organization supplies one only when the deal has none.
//
// An earlier draft of this change made the rule transition-aware ("attaching
// the org classifies it, later saves preserve it"). It was rejected: it kept a
// back door open — attaching an organization to an already-classified, already
// BOOKED deal would silently reclassify it, changing what the deal is without
// going through the conversion flow that owns exactly that change. One rule,
// no transition state, no exception, no back door.
//
// The visible consequence, and it is the intended one: attaching an
// organization to a deal that already says 'private' or 'group' leaves it
// saying that. The operator sets business from the activity badge, one click
// away, if that is what they mean. Nothing is decided for them.
//
// Pure function — deal create, deal update, ingress and the reservations
// processor all call it with the RESULTING state (incoming value if sent, else
// the existing one), so attach, replace and detach all flow through this single
// rule.
// The ONE derived read of the effective organization type: the linked
// organization's type when an organization is attached (even when that org has
// no type — a stale deal-level value must never contradict it), else the
// deal's own manual classification. Shapes follow the Prisma includes
// (deal.organizationType / deal.organization.organizationType relations).
export function effectiveOrgType(deal) {
  return (
    (deal?.organization ? deal.organization.organizationType : deal?.organizationType) || null
  );
}

export function effectiveOrgTypeId(deal) {
  return (
    (deal?.organization ? deal.organization.organizationTypeId : deal?.organizationTypeId) ||
    null
  );
}

export function normalizeClassification({
  organizationId, // resulting org link (string | null)
  activityType, // resulting activity type as requested/kept (string | null)
  organizationTypeId, // resulting deal-level org type as requested/kept (string | null)
  organizationSubtypeId, // resulting subtype as requested/kept (string | null)
  orgTypeId, // the linked organization's OWN type (string | null); unused when no org
  subtypeTypeId, // the resulting subtype's parent type (null = generic); unused when no subtype
} = {}) {
  if (!organizationId) {
    // Deal-owned classification — persisted exactly as chosen.
    return {
      activityType: activityType || null,
      organizationTypeId: organizationTypeId || null,
      organizationSubtypeId: organizationSubtypeId || null,
    };
  }
  const subtypeBelongs =
    !organizationSubtypeId || !subtypeTypeId || subtypeTypeId === (orgTypeId || null);
  return {
    // The whole activity rule: keep what the deal says, and let the
    // organization answer only when it says nothing. Persisting a null next to
    // a linked organization would be its own bug, so the fallback is real.
    activityType: activityType || 'business',
    organizationTypeId: null,
    organizationSubtypeId: subtypeBelongs ? organizationSubtypeId || null : null,
  };
}
