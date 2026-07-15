// The FINAL migration result of an Organizations cluster.
//
// PER-SOURCE model: every legacy Organization row inside a cluster gets exactly ONE
// binding disposition. A cluster-level approval is NOT sufficient — the import
// consumes the per-source map, so every source id must have an explicit answer.
//
//   organization        → the canonical Organization of THIS cluster
//   unit                → a specific Unit under this cluster's canonical Organization
//   other_organization  → a DIFFERENT Organization (another proposal / an existing
//                         GOS org / a new standalone), optionally a Unit of it
//   excluded            → do NOT create an Organization from this row. The raw
//                         snapshot record is untouched and stays in the archive, but
//                         every linked Deal/Contact must still get a destination.
//
// Identity is carried by STABLE KEYS, never display names. Names stay editable.
//
//   prop:<subjectKey>   the canonical Organization of a migration proposal cluster
//   gos:<organizationId> an existing live GOS Organization
//   new:<sourceOrgId>   a new standalone Organization created from that source row
//   unit key            scoped to its organization
//
// One resolver drives the live preview, the stored decision and the eventual import.
// Pure functions, no I/O. Cross-cluster checks that need the ledger live in
// service.js (target existence / cycles) — everything local is validated here.

export const DISPOSITIONS = ['organization', 'unit', 'other_organization', 'excluded'];
export const orgKeyForProposal = (subjectKey) => `prop:${subjectKey}`;
export const orgKeyForGos = (id) => `gos:${id}`;
export const orgKeyForStandalone = (sourceId) => `new:${sourceId}`;

// Linked-entity treatments available when a source row is excluded.
export const DEAL_TREATMENTS = ['reassign', 'exceptional'];
export const CONTACT_TREATMENTS = ['reassign', 'no_organization', 'exceptional'];

function upgradeLegacyDecision(base, proposal) {
  if (!base) return null;
  if (base.dispositions) return base; // already the per-source model

  // v2: { canonicalName, units:[{key,name}], assignments:{id:'organization'|'unit:k'|'separate'} }
  // v1: { canonicalName, units:[{name,fromLegacyId}], roles:{id:'canonical'|'same'|'unit'|'separate'} }
  const units = (base.units || []).map((u, i) => ({
    key: u.key ?? (u.fromLegacyId != null ? `u${u.fromLegacyId}` : `n${i}`),
    name: u.name,
  }));
  const dispositions = {};
  const source = base.assignments || base.roles || {};
  for (const [legacyId, v] of Object.entries(source)) {
    if (v === 'separate') {
      // "keep as its own organisation" → an explicit standalone target.
      dispositions[legacyId] = { disposition: 'other_organization', targetOrganizationKey: orgKeyForStandalone(legacyId), targetUnitKey: null };
    } else if (v === 'unit' || String(v).startsWith('unit:')) {
      const key = String(v).startsWith('unit:') ? String(v).slice(5) : `u${legacyId}`;
      dispositions[legacyId] = { disposition: 'unit', targetUnitKey: key };
    } else {
      dispositions[legacyId] = { disposition: 'organization' };
    }
  }
  return { ...base, units, dispositions, upgradedFrom: base.assignments ? 'v2' : 'v1' };
}

export function draftFromProposal(proposal, decision = null) {
  const base = upgradeLegacyDecision(decision && decision.canonicalName ? decision : null, proposal);
  const dispositions = {};
  for (const m of proposal.members) {
    const prior = base?.dispositions?.[m.legacyId] ?? base?.dispositions?.[String(m.legacyId)];
    if (prior) { dispositions[m.legacyId] = { ...prior }; continue; }
    // Default from the proposal — still just a suggestion the owner overrides.
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

// targets: optional registry for cross-cluster validation —
//   { orgs: Map<orgKey, { name, units: Set<unitKey> }>, selfKey }
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
    if (!d || !d.disposition) { problems.push(`לרשומה "${m.name}" לא נבחר יעד`); continue; }
    if (!DISPOSITIONS.includes(d.disposition)) { problems.push(`יעד לא חוקי לרשומה "${m.name}"`); continue; }

    if (d.disposition === 'organization') { organizationMembers.push(m); continue; }

    if (d.disposition === 'unit') {
      if (!d.targetUnitKey || !unitsByKey.has(d.targetUnitKey)) {
        problems.push(`לרשומה "${m.name}" נבחרה יחידה שאינה קיימת בארגון הזה`);
        continue;
      }
      if (!unitMembers.has(d.targetUnitKey)) unitMembers.set(d.targetUnitKey, []);
      unitMembers.get(d.targetUnitKey).push(m);
      continue;
    }

    if (d.disposition === 'other_organization') {
      if (!d.targetOrganizationKey) { problems.push(`לרשומה "${m.name}" לא נבחר ארגון יעד`); continue; }
      if (targets?.selfKey && d.targetOrganizationKey === targets.selfKey) {
        problems.push(`לרשומה "${m.name}" נבחר הארגון של הקבוצה הזו — יש לבחור "הארגון הראשי" במקום`);
        continue;
      }
      if (targets?.orgs) {
        const t = targets.orgs.get(d.targetOrganizationKey);
        if (!t && !d.targetOrganizationKey.startsWith('new:')) {
          problems.push(`ארגון היעד של "${m.name}" לא נמצא`);
          continue;
        }
        if (d.targetUnitKey && t && !t.units.has(d.targetUnitKey)) {
          problems.push(`היחידה שנבחרה ל-"${m.name}" אינה שייכת לארגון היעד`);
          continue;
        }
      }
      elsewhere.push({ m, target: d.targetOrganizationKey, unit: d.targetUnitKey || null });
      continue;
    }

    // excluded — the row never becomes an Organization, but its linked records must land somewhere.
    const t = d.linkedEntityTreatment || {};
    if ((m.dealCount || 0) > 0) {
      if (!t.deals || !DEAL_TREATMENTS.includes(t.deals)) {
        problems.push(`"${m.name}" מוחרג אך יש לו ${m.dealCount} עסקאות ללא יעד`);
      } else if (t.deals === 'reassign' && !t.dealsTargetOrganizationKey) {
        problems.push(`"${m.name}" — לא נבחר ארגון יעד לעסקאות`);
      }
    }
    if ((m.contactCount || 0) > 0) {
      if (!t.contacts || !CONTACT_TREATMENTS.includes(t.contacts)) {
        problems.push(`"${m.name}" מוחרג אך יש לו ${m.contactCount} אנשי קשר ללא יעד`);
      } else if (t.contacts === 'reassign' && !t.contactsTargetOrganizationKey) {
        problems.push(`"${m.name}" — לא נבחר ארגון יעד לאנשי הקשר`);
      }
    }
    if (m.operationallyActive) {
      warnings.push(`"${m.name}" מוחרג למרות ${m.activeDealCount} עסקאות פעילות ו-${m.futureTourDeals} סיורים עתידיים`);
    }
    excluded.push({ m, treatment: t });
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

  // A unit needs a parent: if nothing is assigned to the organization itself, the
  // canonical org is not created and its units have nowhere to live.
  if (units.length && !organizationMembers.length) {
    problems.push('הוגדרו יחידות אך אף רשומה לא שויכה לארגון הראשי');
  }
  if (organizationMembers.length && !canonicalName) problems.push('חסר שם לארגון הראשי');
  for (const u of units) if (!u.name) problems.push('ליחידה אחת חסר שם');
  const dup = units.map((u) => u.name).filter((n, i, a) => n && a.indexOf(n) !== i);
  if (dup.length) problems.push(`שמות יחידות כפולים: ${[...new Set(dup)].join(', ')}`);

  const createsOrganization = organizationMembers.length > 0;
  const affected = (list) => ({
    deals: list.reduce((n, x) => n + ((x.m || x).dealCount || 0), 0),
    contacts: list.reduce((n, x) => n + ((x.m || x).contactCount || 0), 0),
  });

  return {
    organization: createsOrganization
      ? {
          key: targets?.selfKey || null,
          name: canonicalName,
          organizationTypeId: draft.organizationTypeId || null,
          mergeIntoGosId: draft.mergeIntoGosId || null,
          members: organizationMembers.map((m) => ({ legacyId: m.legacyId, name: m.name })),
          deals: organizationMembers.reduce((n, m) => n + (m.dealCount || 0), 0),
          contacts: organizationMembers.reduce((n, m) => n + (m.contactCount || 0), 0),
        }
      : null,
    units,
    emptyUnits,
    // Records sent to a DIFFERENT organization — they leave this cluster's result.
    elsewhere: elsewhere.map((e) => ({
      legacyId: e.m.legacyId, name: e.m.name, deals: e.m.dealCount || 0, contacts: e.m.contactCount || 0,
      targetOrganizationKey: e.target, targetUnitKey: e.unit,
      targetName: targets?.orgs?.get(e.target)?.name || (e.target.startsWith('new:') ? `${e.m.name} (ארגון עצמאי חדש)` : e.target),
      targetUnitName: e.unit ? targets?.orgs?.get(e.target)?.unitNames?.get(e.unit) || e.unit : null,
    })),
    excluded: excluded.map((e) => ({
      legacyId: e.m.legacyId, name: e.m.name,
      deals: e.m.dealCount || 0, contacts: e.m.contactCount || 0,
      activeDeals: e.m.activeDealCount || 0, futureTours: e.m.futureTourDeals || 0,
      treatment: e.treatment,
    })),
    totals: {
      sourceRecords: members.length,
      organizationsCreated: createsOrganization ? 1 : 0,
      unitsCreated: units.length,
      sentElsewhere: elsewhere.length,
      excluded: excluded.length,
      dealsAffected: affected(members.map((m) => ({ m }))).deals,
      contactsAffected: affected(members.map((m) => ({ m }))).contacts,
    },
    warnings,
    problems,
    valid: problems.length === 0,
  };
}

export function decisionFromDraft(proposal, draft, targets = null) {
  const result = resolveOrgResult(proposal, draft, targets);
  return {
    canonicalName: result.organization?.name ?? String(draft.canonicalName || '').trim(),
    organizationTypeId: draft.organizationTypeId || null,
    mergeIntoGosId: draft.mergeIntoGosId || null,
    units: (draft.units || []).map((u) => ({ key: u.key, name: String(u.name || '').trim() })),
    // THE binding artefact: one disposition per legacy source organization id.
    dispositions: Object.fromEntries(
      Object.entries(draft.dispositions || {}).map(([id, d]) => [id, { ...d }]),
    ),
    result,
  };
}
