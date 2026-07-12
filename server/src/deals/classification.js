// Deal classification — the ONE reconciliation rule between a Deal's
// activity/org-type fields and its linked Organization.
//
// Business rule (SSOT):
//   • A linked Organization makes the deal BUSINESS, always.
//   • The Organization's own type is the deal's effective organization type —
//     Deal.organizationTypeId is force-cleared so no contradicting copy can
//     ever be persisted next to a linked org. Manual selection is only
//     authoritative while NO organization is linked.
//   • The subtype stays deal-owned, but must belong to the effective type:
//     a subtype scoped to a different type is cleared on org attach/change
//     (generic, type-less subtypes always survive).
//   • No organization → the deal owns all three fields (manual selection).
//
// Pure function — both deal create and deal update call it with the RESULTING
// state (incoming value if sent, else the existing one), so attach, replace
// and detach all flow through this single rule.
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
    activityType: 'business',
    organizationTypeId: null,
    organizationSubtypeId: subtypeBelongs ? organizationSubtypeId || null : null,
  };
}
