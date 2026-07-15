// The FINAL migration result of a Contacts cluster.
//
// One resolver for the live preview, the stored decision, and the eventual
// import — so they cannot drift. Pure functions, no I/O.
//
// Model: one record is the PRIMARY (the contact GOS keeps). Every other record is
// either MERGED into it (its phones/emails/deals fold in) or split off as its own
// SEPARATE contact. Nothing merges without an explicit human decision.

export function contactDraftFromProposal(proposal, decision = null) {
  const base = decision && decision.primaryLegacyId != null ? decision : null;
  const ids = proposal.members.map((m) => m.legacyId);
  const primaryLegacyId = base?.primaryLegacyId ?? proposal.proposedPrimaryLegacyId;
  const separate = new Set(base?.separateLegacyIds ?? proposal.proposedSeparateLegacyIds ?? []);
  return {
    primaryLegacyId,
    // Everything that is neither primary nor explicitly separate is merged.
    assignments: Object.fromEntries(
      ids.map((id) => [
        id,
        id === primaryLegacyId ? 'primary' : separate.has(id) ? 'separate' : 'merge',
      ]),
    ),
  };
}

export function resolveContactResult(proposal, draft) {
  const members = proposal.members || [];
  const byId = new Map(members.map((m) => [m.legacyId, m]));
  const primary = byId.get(draft.primaryLegacyId) || null;

  const merged = [];
  const separate = [];
  for (const m of members) {
    if (m.legacyId === draft.primaryLegacyId) continue;
    const a = draft.assignments?.[m.legacyId] || 'merge';
    if (a === 'separate') separate.push(m); else merged.push(m);
  }

  const problems = [];
  if (!primary) problems.push('לא נבחר איש קשר ראשי');

  // Everything the surviving contact ends up owning — shown in the preview so the
  // owner sees exactly what merging costs/keeps. Raw values, never normalised.
  const keep = primary ? [primary, ...merged] : merged;
  const phones = [...new Set(keep.flatMap((m) => m.phones || []))];
  const emails = [...new Set(keep.flatMap((m) => m.emails || []))];
  const orgNames = [...new Set(keep.map((m) => m.orgName).filter(Boolean))];

  return {
    primary: primary
      ? {
          legacyId: primary.legacyId, name: primary.name,
          phones, emails, orgNames,
          deals: keep.reduce((n, m) => n + (m.dealCount || 0), 0),
          activeDeals: keep.reduce((n, m) => n + (m.activeDealCount || 0), 0),
          absorbs: merged.map((m) => ({ legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0 })),
        }
      : null,
    separate: separate.map((m) => ({ legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0 })),
    totals: {
      contactsAfter: (primary ? 1 : 0) + separate.length,
      contactsBefore: members.length,
      mergedAway: merged.length,
    },
    warnings: orgNames.length > 1 ? [`הרשומות משויכות ל-${orgNames.length} ארגונים שונים: ${orgNames.join(' · ')}`] : [],
    problems,
    valid: problems.length === 0,
  };
}

export function contactDecisionFromDraft(proposal, draft) {
  const result = resolveContactResult(proposal, draft);
  const mergeLegacyIds = Object.entries(draft.assignments || {})
    .filter(([id, a]) => a === 'merge' && Number(id) !== draft.primaryLegacyId)
    .map(([id]) => Number(id));
  const separateLegacyIds = Object.entries(draft.assignments || {})
    .filter(([, a]) => a === 'separate')
    .map(([id]) => Number(id));
  return {
    primaryLegacyId: draft.primaryLegacyId,
    mergeLegacyIds,
    separateLegacyIds,
    result,
  };
}

// The decision a BATCH approval records for a safe cluster: exactly the proposal,
// nothing invented. Kept here so batch and single approval share one meaning.
export function batchDecisionFor(proposal) {
  const draft = contactDraftFromProposal(proposal, null);
  return contactDecisionFromDraft(proposal, draft);
}
