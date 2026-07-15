// Live preview of what GOS will create for an Organizations cluster.
//
// This mirrors the server's resolver (src/migration/review/orgDecision.js), which
// is the authority: the server re-resolves on save and rejects an invalid result.
// The preview exists so the owner sees the outcome WHILE editing.
// Decisions recorded before units had stable keys used {name, fromLegacyId} + a
// per-record `roles` map. Upgrade them so an early owner decision re-opens with
// the owner's own edits. Mirrors the server (orgDecision.js).
function upgradeLegacyDecision(base) {
  if (!base || base.assignments) return base;
  if (!base.roles && !base.units) return base;
  const units = (base.units || []).map((u, i) => ({
    key: u.key ?? (u.fromLegacyId != null ? `u${u.fromLegacyId}` : `n${i}`),
    name: u.name,
  }));
  const assignments = Object.fromEntries(
    Object.entries(base.roles || {}).map(([legacyId, role]) => {
      if (role === 'separate') return [legacyId, 'separate'];
      if (role === 'unit') return [legacyId, `unit:u${legacyId}`];
      return [legacyId, 'organization'];
    }),
  );
  return { ...base, units, assignments };
}

export function draftFromProposal(proposal, decision = null) {
  const base = upgradeLegacyDecision(decision && decision.canonicalName ? decision : null);
  return {
    canonicalName: base?.canonicalName ?? proposal.proposedCanonical.name,
    organizationTypeId: base?.organizationTypeId ?? proposal.proposedCanonical.organizationTypeId ?? null,
    mergeIntoGosId: base?.mergeIntoGosId ?? null,
    units: (base?.units ?? proposal.proposedUnits ?? []).map((u) => ({ key: u.key, name: u.name })),
    assignments: { ...(proposal.proposedAssignments || {}), ...(base?.assignments || {}) },
  };
}

export function resolveOrgResult(proposal, draft) {
  const canonicalName = String(draft.canonicalName || '').trim();
  const unitsByKey = new Map((draft.units || []).map((u) => [u.key, String(u.name || '').trim()]));
  const members = proposal.members || [];

  const organizationMembers = [];
  const separateMembers = [];
  const unitMembers = new Map();

  for (const m of members) {
    const a = draft.assignments?.[m.legacyId] || 'organization';
    if (a === 'separate') { separateMembers.push(m); continue; }
    if (a.startsWith('unit:')) {
      const key = a.slice(5);
      if (!unitsByKey.has(key)) { organizationMembers.push(m); continue; }
      if (!unitMembers.has(key)) unitMembers.set(key, []);
      unitMembers.get(key).push(m);
      continue;
    }
    organizationMembers.push(m);
  }

  const units = [...unitsByKey.entries()]
    .filter(([key]) => (unitMembers.get(key) || []).length > 0)
    .map(([key, name]) => ({
      key, name,
      members: unitMembers.get(key).map((m) => ({ legacyId: m.legacyId, name: m.name })),
      deals: unitMembers.get(key).reduce((n, m) => n + (m.dealCount || 0), 0),
      contacts: unitMembers.get(key).reduce((n, m) => n + (m.contactCount || 0), 0),
    }));

  const emptyUnits = [...unitsByKey.entries()]
    .filter(([key]) => (unitMembers.get(key) || []).length === 0)
    .map(([key, name]) => ({ key, name }));

  const problems = [];
  if (!canonicalName) problems.push('חסר שם לארגון הראשי');
  for (const u of units) if (!u.name) problems.push('ליחידה אחת חסר שם');
  const dupUnit = units.map((u) => u.name).filter((n, i, a) => n && a.indexOf(n) !== i);
  if (dupUnit.length) problems.push(`שמות יחידות כפולים: ${[...new Set(dupUnit)].join(', ')}`);
  if (!organizationMembers.length && !separateMembers.length && !units.length) problems.push('לא שויכה אף רשומה');

  return {
    organization: {
      name: canonicalName,
      organizationTypeId: draft.organizationTypeId || null,
      mergeIntoGosId: draft.mergeIntoGosId || null,
      members: organizationMembers.map((m) => ({ legacyId: m.legacyId, name: m.name })),
      deals: organizationMembers.reduce((n, m) => n + (m.dealCount || 0), 0),
      contacts: organizationMembers.reduce((n, m) => n + (m.contactCount || 0), 0),
    },
    units,
    emptyUnits,
    separate: separateMembers.map((m) => ({ legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0 })),
    totals: { organizations: 1 + separateMembers.length, units: units.length, records: members.length },
    problems,
    valid: problems.length === 0,
  };
}
