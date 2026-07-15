import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftFromProposal, resolveOrgResult, decisionFromDraft,
  orgKeyForProposal, orgKeyForGos, orgKeyForStandalone,
} from './orgDecision.js';

// The real false-positive cluster from the audit (iCount 15641).
const FP = {
  kind: 'organization_cluster',
  clusterKind: 'icountId',
  members: [
    { legacyId: 220, name: 'IMD SOFT', dealCount: 3, contactCount: 2, activeDealCount: 0, futureTourDeals: 0 },
    { legacyId: 361, name: 'STORE NEXT', dealCount: 2, contactCount: 1, activeDealCount: 0, futureTourDeals: 0 },
    { legacyId: 414, name: 'ניסיון למחוק', dealCount: 0, contactCount: 0, activeDealCount: 0, futureTourDeals: 0 },
    { legacyId: 727, name: 'קפה ומאפה', dealCount: 4, contactCount: 3, activeDealCount: 2, futureTourDeals: 1, operationallyActive: true },
  ],
  proposedCanonical: { name: 'IMD SOFT', organizationTypeId: null },
  proposedUnits: [],
  proposedAssignments: { 220: 'organization', 361: 'organization', 414: 'organization', 727: 'organization' },
};

const TARGETS = {
  selfKey: orgKeyForProposal('org:icountId:ic:15641'),
  orgs: new Map([
    ['prop:org:normName:store next', { name: 'STORE NEXT', units: new Set(), unitNames: new Map() }],
    ['prop:org:taxId:520000001', { name: 'Bank Leumi', units: new Set(['cm']), unitNames: new Map([['cm', 'Capital Markets Division']]) }],
    ['gos:gosA', { name: 'ארגון קיים', units: new Set(['gosU1']), unitNames: new Map([['gosU1', 'סניף קיים']]) }],
  ]),
};

test('every source record carries exactly one binding disposition', () => {
  const d = draftFromProposal(FP);
  assert.deepEqual(Object.keys(d.dispositions).map(Number).sort((a, b) => a - b), [220, 361, 414, 727]);
  for (const v of Object.values(d.dispositions)) assert.ok(v.disposition);
});

test('approval is BLOCKED when a source record has no disposition', () => {
  const d = draftFromProposal(FP);
  delete d.dispositions[361];
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, false);
  assert.match(r.problems.join(), /STORE NEXT.*לא נבחר יעד/);
});

test('an unrelated record can be REMOVED from a false-positive cluster to another migration proposal', () => {
  const d = draftFromProposal(FP);
  d.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:store next', targetUnitKey: null };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true);
  // It leaves this cluster's result entirely…
  assert.ok(!r.organization.members.some((m) => m.legacyId === 361));
  // …and appears in the target mapping context, by NAME for the human.
  assert.deepEqual(r.elsewhere.map((e) => e.legacyId), [361]);
  assert.equal(r.elsewhere[0].targetName, 'STORE NEXT');
  assert.equal(r.totals.sentElsewhere, 1);
});

test('a removed record can map to an existing GOS Organization, including a Unit of it', () => {
  const d = draftFromProposal(FP);
  d.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: orgKeyForGos('gosA'), targetUnitKey: 'gosU1' };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true);
  assert.equal(r.elsewhere[0].targetName, 'ארגון קיים');
  assert.equal(r.elsewhere[0].targetUnitName, 'סניף קיים');
});

test('a removed record can become a NEW standalone Organization', () => {
  const d = draftFromProposal(FP);
  d.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: orgKeyForStandalone(361), targetUnitKey: null };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true);
  assert.match(r.elsewhere[0].targetName, /ארגון עצמאי חדש/);
});

test('a Unit that does not belong to the target Organization is REFUSED', () => {
  const d = draftFromProposal(FP);
  d.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:store next', targetUnitKey: 'cm' };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, false);
  assert.match(r.problems.join(), /אינה שייכת לארגון היעד/);
});

test('a missing target Organization is REFUSED; self-referential mapping is REFUSED', () => {
  const d1 = draftFromProposal(FP);
  d1.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: 'prop:does-not-exist' };
  assert.match(resolveOrgResult(FP, d1, TARGETS).problems.join(), /לא נמצא/);

  const d2 = draftFromProposal(FP);
  d2.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: TARGETS.selfKey };
  assert.match(resolveOrgResult(FP, d2, TARGETS).problems.join(), /הארגון של הקבוצה הזו/);
});

test('a junk record can be EXCLUDED — and its evidence is never destroyed', () => {
  const d = draftFromProposal(FP);
  d.dispositions[414] = { disposition: 'excluded' }; // ניסיון למחוק: 0 deals, 0 contacts
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true, 'no linked records → no treatment needed');
  assert.deepEqual(r.excluded.map((e) => e.name), ['ניסיון למחוק']);
  assert.equal(r.totals.excluded, 1);
  // The source row is still fully described in the decision — nothing is deleted.
  assert.equal(r.excluded[0].legacyId, 414);
});

test('excluding a record with linked Deals/Contacts is BLOCKED until they get a destination', () => {
  const d = draftFromProposal(FP);
  d.dispositions[220] = { disposition: 'excluded' }; // 3 deals, 2 contacts
  const blocked = resolveOrgResult(FP, d, TARGETS);
  assert.equal(blocked.valid, false);
  assert.match(blocked.problems.join(), /3 עסקאות ללא יעד/);
  assert.match(blocked.problems.join(), /2 אנשי קשר ללא יעד/);

  // Deals reassigned, contacts kept without an organization → valid.
  d.dispositions[220] = {
    disposition: 'excluded',
    linkedEntityTreatment: { deals: 'reassign', dealsTargetOrganizationKey: 'prop:org:normName:store next', contacts: 'no_organization' },
  };
  assert.equal(resolveOrgResult(FP, d, TARGETS).valid, true);

  // "reassign" without a target is still incomplete.
  d.dispositions[220] = { disposition: 'excluded', linkedEntityTreatment: { deals: 'reassign', contacts: 'no_organization' } };
  assert.match(resolveOrgResult(FP, d, TARGETS).problems.join(), /לא נבחר ארגון יעד לעסקאות/);
});

test('linked Deals and Contacts can be routed to Exceptional Records', () => {
  const d = draftFromProposal(FP);
  d.dispositions[220] = { disposition: 'excluded', linkedEntityTreatment: { deals: 'exceptional', contacts: 'exceptional' } };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true);
  assert.equal(r.excluded[0].treatment.deals, 'exceptional');
});

test('excluding an operationally-active record raises a STRONG warning (but is allowed)', () => {
  const d = draftFromProposal(FP);
  d.dispositions[727] = { disposition: 'excluded', linkedEntityTreatment: { deals: 'exceptional', contacts: 'exceptional' } };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true, 'the owner may still do it');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /2 עסקאות פעילות ו-1 סיורים עתידיים/);
});

test('a unit with no parent organization is refused; units roll up their records', () => {
  const d = draftFromProposal(FP);
  d.units = [{ key: 'br', name: 'סניף צפון' }];
  // Everyone into the unit, nobody on the organization itself.
  for (const id of [220, 361, 414, 727]) d.dispositions[id] = { disposition: 'unit', targetUnitKey: 'br' };
  const bad = resolveOrgResult(FP, d, TARGETS);
  assert.equal(bad.valid, false);
  assert.match(bad.problems.join(), /אף רשומה לא שויכה לארגון הראשי/);

  d.dispositions[220] = { disposition: 'organization' };
  const good = resolveOrgResult(FP, d, TARGETS);
  assert.equal(good.valid, true);
  assert.equal(good.units[0].members.length, 3, 'three records → one unit');
  assert.equal(good.units[0].deals, 6);
});

test('the preview reports the complete post-migration result', () => {
  const d = draftFromProposal(FP);
  d.canonicalName = 'IMD Soft Ltd';
  d.units = [{ key: 'br', name: 'סניף' }];
  d.dispositions = {
    220: { disposition: 'organization' },
    361: { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:store next' },
    414: { disposition: 'excluded' },
    727: { disposition: 'unit', targetUnitKey: 'br' },
  };
  const r = resolveOrgResult(FP, d, TARGETS);
  assert.equal(r.valid, true);
  assert.equal(r.organization.name, 'IMD Soft Ltd');
  assert.deepEqual(r.totals, {
    sourceRecords: 4, organizationsCreated: 1, unitsCreated: 1, sentElsewhere: 1, excluded: 1,
    dealsAffected: 9, contactsAffected: 6,
  });
});

test('the stored decision is the per-source mapping, keyed by legacy source id', () => {
  const d = draftFromProposal(FP);
  d.canonicalName = 'Bank Leumi';
  d.units = [{ key: 'cm', name: 'Capital Markets Division' }];
  d.dispositions = {
    220: { disposition: 'organization' },
    361: { disposition: 'unit', targetUnitKey: 'cm' },
    414: { disposition: 'excluded' },
    727: { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:store next', targetUnitKey: null },
  };
  const stored = decisionFromDraft(FP, d, TARGETS);
  assert.equal(stored.canonicalName, 'Bank Leumi');
  assert.deepEqual(stored.dispositions['220'], { disposition: 'organization' });
  assert.deepEqual(stored.dispositions['361'], { disposition: 'unit', targetUnitKey: 'cm' });
  assert.deepEqual(stored.dispositions['414'], { disposition: 'excluded' });
  assert.equal(stored.dispositions['727'].targetOrganizationKey, 'prop:org:normName:store next');
  // Keys, not display names, are the binding identity.
  assert.deepEqual(stored.units, [{ key: 'cm', name: 'Capital Markets Division' }]);
  assert.equal(stored.result.valid, true);
});

test('re-opening restores the owner mapping exactly (persists after reload)', () => {
  const d = draftFromProposal(FP);
  d.dispositions[361] = { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:store next', targetUnitKey: null };
  d.dispositions[414] = { disposition: 'excluded' };
  const stored = decisionFromDraft(FP, d, TARGETS);

  const reopened = draftFromProposal(FP, stored);
  assert.equal(reopened.dispositions[361].disposition, 'other_organization');
  assert.equal(reopened.dispositions[361].targetOrganizationKey, 'prop:org:normName:store next');
  assert.equal(reopened.dispositions[414].disposition, 'excluded');
});

// ── forward-migration of pre-existing owner decisions ───────────────────────
test('a v2 decision (assignments) upgrades into the per-source model', () => {
  const v2 = {
    canonicalName: 'Bank Leumi',
    units: [{ key: 'cm', name: 'Capital Markets Division' }],
    assignments: { 220: 'organization', 361: 'unit:cm', 414: 'separate', 727: 'organization' },
  };
  const d = draftFromProposal(FP, v2);
  assert.equal(d.canonicalName, 'Bank Leumi');
  assert.equal(d.dispositions[220].disposition, 'organization');
  assert.equal(d.dispositions[361].disposition, 'unit');
  assert.equal(d.dispositions[361].targetUnitKey, 'cm');
  // "separate" was unambiguous: its own standalone organization.
  assert.equal(d.dispositions[414].disposition, 'other_organization');
  assert.equal(d.dispositions[414].targetOrganizationKey, 'new:414');
});

test('a v1 decision (roles + keyless units) upgrades into the per-source model', () => {
  const v1 = {
    canonicalName: 'IMD SOFT',
    units: [{ name: 'סניף', fromLegacyId: 361 }],
    roles: { 220: 'canonical', 361: 'unit', 414: 'same', 727: 'separate' },
  };
  const d = draftFromProposal(FP, v1);
  assert.equal(d.units[0].key, 'u361', 'keyless unit gets a stable key');
  assert.equal(d.dispositions[220].disposition, 'organization');
  assert.equal(d.dispositions[361].targetUnitKey, 'u361');
  assert.equal(d.dispositions[414].disposition, 'organization', '"same" → the canonical organization');
  assert.equal(d.dispositions[727].targetOrganizationKey, 'new:727');
});
