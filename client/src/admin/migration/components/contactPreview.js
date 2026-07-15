// Live preview of what GOS will keep for a Contacts cluster.
// Mirrors the server resolver (src/migration/review/contactDecision.js), which is
// the authority: it re-resolves on save and refuses an invalid result.
export function contactDraftFromProposal(proposal, decision = null) {
  const base = decision && decision.primaryLegacyId != null ? decision : null;
  const ids = proposal.members.map((m) => m.legacyId);
  const primaryLegacyId = base?.primaryLegacyId ?? proposal.proposedPrimaryLegacyId;
  const separate = new Set(base?.separateLegacyIds ?? proposal.proposedSeparateLegacyIds ?? []);
  return {
    primaryLegacyId,
    assignments: Object.fromEntries(
      ids.map((id) => [id, id === primaryLegacyId ? 'primary' : separate.has(id) ? 'separate' : 'merge']),
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

  const keep = primary ? [primary, ...merged] : merged;
  const phones = [...new Set(keep.flatMap((m) => m.phones || []))];
  const emails = [...new Set(keep.flatMap((m) => m.emails || []))];
  const orgNames = [...new Set(keep.map((m) => m.orgName).filter(Boolean))];

  return {
    primary: primary
      ? {
          legacyId: primary.legacyId, name: primary.name, phones, emails, orgNames,
          deals: keep.reduce((n, m) => n + (m.dealCount || 0), 0),
          activeDeals: keep.reduce((n, m) => n + (m.activeDealCount || 0), 0),
          absorbs: merged.map((m) => ({ legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0 })),
        }
      : null,
    separate: separate.map((m) => ({ legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0 })),
    totals: { contactsAfter: (primary ? 1 : 0) + separate.length, contactsBefore: members.length, mergedAway: merged.length },
    warnings: orgNames.length > 1 ? [`הרשומות משויכות ל-${orgNames.length} ארגונים שונים: ${orgNames.join(' · ')}`] : [],
    problems,
    valid: problems.length === 0,
  };
}
