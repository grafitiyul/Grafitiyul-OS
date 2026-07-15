// Live preview of what GOS will create for an Organizations cluster.
//
// Mirrors the server resolver (src/migration/review/orgDecision.js), which is the
// authority: it re-resolves against the LIVE target registry on save and refuses an
// invalid result. This copy exists so the owner sees the outcome WHILE editing.
export const DISPOSITIONS = ['organization', 'unit', 'other_organization', 'excluded'];
export const orgKeyForStandalone = (sourceId) => `new:${sourceId}`;

function upgradeLegacyDecision(base) {
  if (!base) return null;
  if (base.dispositions) return base;
  const units = (base.units || []).map((u, i) => ({
    key: u.key ?? (u.fromLegacyId != null ? `u${u.fromLegacyId}` : `n${i}`),
    name: u.name,
  }));
  const dispositions = {};
  for (const [legacyId, v] of Object.entries(base.assignments || base.roles || {})) {
    if (v === 'separate') dispositions[legacyId] = { disposition: 'other_organization', targetOrganizationKey: orgKeyForStandalone(legacyId), targetUnitKey: null };
    else if (v === 'unit' || String(v).startsWith('unit:')) dispositions[legacyId] = { disposition: 'unit', targetUnitKey: String(v).startsWith('unit:') ? String(v).slice(5) : `u${legacyId}` };
    else dispositions[legacyId] = { disposition: 'organization' };
  }
  return { ...base, units, dispositions };
}

export function draftFromProposal(proposal, decision = null) {
  const base = upgradeLegacyDecision(decision && decision.canonicalName ? decision : null);
  const dispositions = {};
  for (const m of proposal.members) {
    const prior = base?.dispositions?.[m.legacyId] ?? base?.dispositions?.[String(m.legacyId)];
    if (prior) { dispositions[m.legacyId] = { ...prior }; continue; }
    const a = proposal.proposedAssignments?.[m.legacyId] || 'organization';
    if (a.startsWith('unit:')) dispositions[m.legacyId] = { disposition: 'unit', targetUnitKey: a.slice(5) };
    else if (a === 'separate') dispositions[m.legacyId] = { disposition: 'other_organization', targetOrganizationKey: orgKeyForStandalone(m.legacyId), targetUnitKey: null };
    else dispositions[m.legacyId] = { disposition: 'organization' };
  }
  return {
    canonicalName: base?.canonicalName ?? proposal.proposedCanonical.name,
    organizationTypeId: base?.organizationTypeId ?? proposal.proposedCanonical.organizationTypeId ?? null,
    mergeIntoGosId: base?.mergeIntoGosId ?? null,
    units: (base?.units ?? proposal.proposedUnits ?? []).map((u) => ({ key: u.key, name: u.name })),
    dispositions,
  };
}

// targets: { orgs: Map<key, {name, units:Map<key,name>}>, selfKey }
export function resolveOrgResult(proposal, draft, targets = null) {
  const canonicalName = String(draft.canonicalName || '').trim();
  const unitsByKey = new Map((draft.units || []).map((u) => [u.key, String(u.name || '').trim()]));
  const members = proposal.members || [];
  const problems = [];
  const warnings = [];
  const organizationMembers = [];
  const unitMembers = new Map();
  const elsewhere = [];
  const excluded = [];

  for (const m of members) {
    const d = draft.dispositions?.[m.legacyId];
    if (!d?.disposition) { problems.push(`לרשומה "${m.name}" לא נבחר יעד`); continue; }

    if (d.disposition === 'organization') { organizationMembers.push(m); continue; }

    if (d.disposition === 'unit') {
      if (!d.targetUnitKey || !unitsByKey.has(d.targetUnitKey)) { problems.push(`לרשומה "${m.name}" נבחרה יחידה שאינה קיימת`); continue; }
      if (!unitMembers.has(d.targetUnitKey)) unitMembers.set(d.targetUnitKey, []);
      unitMembers.get(d.targetUnitKey).push(m);
      continue;
    }

    if (d.disposition === 'other_organization') {
      if (!d.targetOrganizationKey) { problems.push(`לרשומה "${m.name}" לא נבחר ארגון יעד`); continue; }
      if (targets?.selfKey && d.targetOrganizationKey === targets.selfKey) { problems.push(`"${m.name}": בחר "הארגון הראשי" במקום`); continue; }
      const t = targets?.orgs?.get(d.targetOrganizationKey);
      if (!t && !d.targetOrganizationKey.startsWith('new:')) { problems.push(`ארגון היעד של "${m.name}" לא נמצא`); continue; }
      if (d.targetUnitKey && t && !t.units.has(d.targetUnitKey)) { problems.push(`היחידה שנבחרה ל-"${m.name}" אינה שייכת לארגון היעד`); continue; }
      elsewhere.push({
        legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0, contacts: m.contactCount || 0,
        targetOrganizationKey: d.targetOrganizationKey, targetUnitKey: d.targetUnitKey || null,
        targetName: t?.name || (d.targetOrganizationKey.startsWith('new:') ? `${m.name} (ארגון עצמאי חדש)` : d.targetOrganizationKey),
        targetUnitName: d.targetUnitKey ? t?.units.get(d.targetUnitKey) || d.targetUnitKey : null,
      });
      continue;
    }

    const t = d.linkedEntityTreatment || {};
    if ((m.dealCount || 0) > 0) {
      if (!t.deals) problems.push(`"${m.name}" מוחרג אך יש לו ${m.dealCount} עסקאות ללא יעד`);
      else if (t.deals === 'reassign' && !t.dealsTargetOrganizationKey) problems.push(`"${m.name}" — לא נבחר ארגון יעד לעסקאות`);
    }
    if ((m.contactCount || 0) > 0) {
      if (!t.contacts) problems.push(`"${m.name}" מוחרג אך יש לו ${m.contactCount} אנשי קשר ללא יעד`);
      else if (t.contacts === 'reassign' && !t.contactsTargetOrganizationKey) problems.push(`"${m.name}" — לא נבחר ארגון יעד לאנשי הקשר`);
    }
    if (m.operationallyActive) warnings.push(`"${m.name}" מוחרג למרות ${m.activeDealCount} עסקאות פעילות ו-${m.futureTourDeals} סיורים עתידיים`);
    excluded.push({
      legacyId: m.legacyId, name: m.name, deals: m.dealCount || 0, contacts: m.contactCount || 0,
      activeDeals: m.activeDealCount || 0, futureTours: m.futureTourDeals || 0, treatment: t,
    });
  }

  const units = [...unitsByKey.entries()]
    .filter(([key]) => (unitMembers.get(key) || []).length > 0)
    .map(([key, name]) => ({
      key, name,
      members: unitMembers.get(key).map((m) => ({ legacyId: m.legacyId, name: m.name })),
      deals: unitMembers.get(key).reduce((n, m) => n + (m.dealCount || 0), 0),
    }));
  const emptyUnits = [...unitsByKey.entries()]
    .filter(([key]) => (unitMembers.get(key) || []).length === 0)
    .map(([key, name]) => ({ key, name }));

  if (units.length && !organizationMembers.length) problems.push('הוגדרו יחידות אך אף רשומה לא שויכה לארגון הראשי');
  if (organizationMembers.length && !canonicalName) problems.push('חסר שם לארגון הראשי');
  for (const u of units) if (!u.name) problems.push('ליחידה אחת חסר שם');
  const dup = units.map((u) => u.name).filter((n, i, a) => n && a.indexOf(n) !== i);
  if (dup.length) problems.push(`שמות יחידות כפולים: ${[...new Set(dup)].join(', ')}`);

  return {
    organization: organizationMembers.length
      ? {
          name: canonicalName,
          members: organizationMembers.map((m) => ({ legacyId: m.legacyId, name: m.name })),
          deals: organizationMembers.reduce((n, m) => n + (m.dealCount || 0), 0),
          contacts: organizationMembers.reduce((n, m) => n + (m.contactCount || 0), 0),
          mergeIntoGosId: draft.mergeIntoGosId || null,
        }
      : null,
    units, emptyUnits, elsewhere, excluded,
    totals: {
      sourceRecords: members.length,
      organizationsCreated: organizationMembers.length ? 1 : 0,
      unitsCreated: units.length,
      sentElsewhere: elsewhere.length,
      excluded: excluded.length,
      dealsAffected: members.reduce((n, m) => n + (m.dealCount || 0), 0),
      contactsAffected: members.reduce((n, m) => n + (m.contactCount || 0), 0),
    },
    warnings, problems, valid: problems.length === 0,
  };
}

// Build the lookup the resolver validates against, from the /org-targets payload.
export function targetsIndex(registry, selfKey) {
  const orgs = new Map();
  for (const t of [...(registry?.proposals || []), ...(registry?.gos || [])]) {
    orgs.set(t.key, { name: t.name, kind: t.kind, units: new Map(t.units.map((u) => [u.key, u.name])) });
  }
  // resolveOrgResult expects .units to answer .has(); a Map does.
  for (const v of orgs.values()) v.units.has = v.units.has.bind(v.units);
  return { orgs, selfKey };
}
