import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromProposal, resolveOrgResult, decisionFromDraft } from './orgDecision.js';

// The owner's real example: four source rows → organization "Bank Leumi" with a
// unit "Capital Markets Division" — names that appear in NO source record.
const LEUMI = {
  kind: 'organization_cluster',
  members: [
    { legacyId: 1, name: 'Bank Leumi Capital Markets', dealCount: 5, contactCount: 2 },
    { legacyId: 2, name: 'Leumi Capital Markets', dealCount: 3, contactCount: 1 },
    { legacyId: 3, name: 'Capital Markets', dealCount: 2, contactCount: 1 },
    { legacyId: 4, name: 'Leumi - Capital', dealCount: 1, contactCount: 0 },
  ],
  proposedCanonical: { name: 'Bank Leumi Capital Markets', organizationTypeId: null },
  proposedUnits: [],
  proposedAssignments: { 1: 'organization', 2: 'organization', 3: 'organization', 4: 'organization' },
};

test('the canonical organization name can be overridden to anything', () => {
  const draft = draftFromProposal(LEUMI);
  assert.equal(draft.canonicalName, 'Bank Leumi Capital Markets', 'starts from the suggestion');
  draft.canonicalName = 'Bank Leumi'; // a name in no source record
  const r = resolveOrgResult(LEUMI, draft);
  assert.equal(r.organization.name, 'Bank Leumi');
  assert.equal(r.valid, true);
});

test('MANY source records collapse into ONE renamed unit', () => {
  const draft = draftFromProposal(LEUMI);
  draft.canonicalName = 'Bank Leumi';
  draft.units = [{ key: 'cm', name: 'Capital Markets Division' }];
  draft.assignments = { 1: 'organization', 2: 'unit:cm', 3: 'unit:cm', 4: 'unit:cm' };

  const r = resolveOrgResult(LEUMI, draft);
  assert.equal(r.organization.name, 'Bank Leumi');
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0].name, 'Capital Markets Division');
  assert.deepEqual(r.units[0].members.map((m) => m.legacyId), [2, 3, 4], 'three records → one unit');
  assert.equal(r.units[0].deals, 6, 'unit deal totals roll up');
  assert.equal(r.totals.organizations, 1);
  assert.equal(r.totals.units, 1);
  assert.equal(r.valid, true);
});

test('the Clalit example: one org + two freely-named units', () => {
  const CLALIT = {
    members: [
      { legacyId: 1, name: 'Clalit', dealCount: 4, contactCount: 3 },
      { legacyId: 2, name: 'Clalit Platinum', dealCount: 2, contactCount: 1 },
      { legacyId: 3, name: 'Clalit Complementary Medicine', dealCount: 1, contactCount: 1 },
    ],
    proposedCanonical: { name: 'Clalit', organizationTypeId: null },
    proposedUnits: [],
    proposedAssignments: { 1: 'organization', 2: 'organization', 3: 'organization' },
  };
  const draft = draftFromProposal(CLALIT);
  draft.canonicalName = 'Clalit Health Services';
  draft.units = [{ key: 'p', name: 'Platinum' }, { key: 'c', name: 'Complementary Medicine' }];
  draft.assignments = { 1: 'organization', 2: 'unit:p', 3: 'unit:c' };

  const r = resolveOrgResult(CLALIT, draft);
  assert.equal(r.organization.name, 'Clalit Health Services');
  assert.deepEqual(r.units.map((u) => u.name), ['Platinum', 'Complementary Medicine']);
  assert.deepEqual(r.units.map((u) => u.members.length), [1, 1]);
});

test('unit names are always editable, including suggested ones', () => {
  const P = {
    members: [{ legacyId: 1, name: 'א', dealCount: 1 }, { legacyId: 2, name: 'א סניff', dealCount: 1 }],
    proposedCanonical: { name: 'א', organizationTypeId: null },
    proposedUnits: [{ key: 'u2', name: 'סניff' }],
    proposedAssignments: { 1: 'organization', 2: 'unit:u2' },
  };
  const draft = draftFromProposal(P);
  assert.equal(draft.units[0].name, 'סניff', 'suggestion carried into the draft');
  draft.units[0].name = 'שם אחר לגמרי';
  const r = resolveOrgResult(P, draft);
  assert.equal(r.units[0].name, 'שם אחר לגמרי');
});

test('a unit with no records assigned is NOT created (and is reported)', () => {
  const draft = draftFromProposal(LEUMI);
  draft.units = [{ key: 'ghost', name: 'יחידת רפאים' }];
  const r = resolveOrgResult(LEUMI, draft);
  assert.equal(r.units.length, 0);
  assert.deepEqual(r.emptyUnits.map((u) => u.name), ['יחידת רפאים']);
});

test('removing a unit falls its records back to the organization', () => {
  const draft = draftFromProposal(LEUMI);
  draft.units = []; // unit deleted while records still point at it
  draft.assignments = { 1: 'organization', 2: 'unit:gone', 3: 'organization', 4: 'organization' };
  const r = resolveOrgResult(LEUMI, draft);
  assert.equal(r.units.length, 0);
  assert.equal(r.organization.members.length, 4, 'no record is silently lost');
});

test('separate records become their own organizations', () => {
  const draft = draftFromProposal(LEUMI);
  draft.canonicalName = 'Bank Leumi';
  draft.assignments = { 1: 'organization', 2: 'organization', 3: 'separate', 4: 'separate' };
  const r = resolveOrgResult(LEUMI, draft);
  assert.equal(r.separate.length, 2);
  assert.equal(r.totals.organizations, 3, '1 canonical + 2 separate');
});

test('invalid results are caught: empty name, duplicate unit names', () => {
  const d1 = draftFromProposal(LEUMI);
  d1.canonicalName = '   ';
  assert.equal(resolveOrgResult(LEUMI, d1).valid, false);
  assert.match(resolveOrgResult(LEUMI, d1).problems[0], /חסר שם/);

  const d2 = draftFromProposal(LEUMI);
  d2.units = [{ key: 'a', name: 'זהה' }, { key: 'b', name: 'זהה' }];
  d2.assignments = { 1: 'organization', 2: 'unit:a', 3: 'unit:b', 4: 'organization' };
  const r2 = resolveOrgResult(LEUMI, d2);
  assert.equal(r2.valid, false);
  assert.match(r2.problems.join(), /כפולים/);
});

test('the stored decision IS the edited result (proposal is only a starting point)', () => {
  const draft = draftFromProposal(LEUMI);
  draft.canonicalName = 'Bank Leumi';
  draft.units = [{ key: 'cm', name: 'Capital Markets Division' }];
  draft.assignments = { 1: 'organization', 2: 'unit:cm', 3: 'unit:cm', 4: 'unit:cm' };

  const stored = decisionFromDraft(LEUMI, draft);
  assert.equal(stored.canonicalName, 'Bank Leumi');
  assert.deepEqual(stored.units, [{ key: 'cm', name: 'Capital Markets Division' }]);
  assert.deepEqual(stored.assignments, draft.assignments);
  // The resolved result travels with the decision for the eventual import.
  assert.equal(stored.result.organization.name, 'Bank Leumi');
  assert.equal(stored.result.units[0].name, 'Capital Markets Division');
  assert.equal(stored.result.valid, true);
});

test('a decision recorded BEFORE unit keys existed still re-opens with the owner edits', () => {
  // The shape the first 12 live decisions were saved in: roles + keyless units.
  const legacy = {
    canonicalName: 'Bank Leumi',
    organizationTypeId: null,
    units: [{ name: 'Capital Markets', fromLegacyId: 2 }],
    roles: { 1: 'canonical', 2: 'unit', 3: 'same', 4: 'separate' },
  };
  const draft = draftFromProposal(LEUMI, legacy);
  assert.equal(draft.canonicalName, 'Bank Leumi', 'owner name preserved');
  assert.deepEqual(draft.units, [{ key: 'u2', name: 'Capital Markets' }], 'unit gets a stable key');
  assert.equal(draft.assignments[1], 'organization');
  assert.equal(draft.assignments[2], 'unit:u2', 'the unit record still points at its unit');
  assert.equal(draft.assignments[3], 'organization');
  assert.equal(draft.assignments[4], 'separate');

  const r = resolveOrgResult(LEUMI, draft);
  assert.equal(r.valid, true);
  assert.equal(r.units[0].name, 'Capital Markets');
  assert.deepEqual(r.units[0].members.map((m) => m.legacyId), [2]);
  assert.equal(r.separate.length, 1);
});

test('re-opening a decided cluster restores the OWNER edits, not the proposal', () => {
  const draft = draftFromProposal(LEUMI);
  draft.canonicalName = 'Bank Leumi';
  draft.units = [{ key: 'cm', name: 'Capital Markets Division' }];
  draft.assignments = { 1: 'organization', 2: 'unit:cm', 3: 'unit:cm', 4: 'unit:cm' };
  const stored = decisionFromDraft(LEUMI, draft);

  const reopened = draftFromProposal(LEUMI, stored);
  assert.equal(reopened.canonicalName, 'Bank Leumi', 'edited name wins over the suggestion');
  assert.deepEqual(reopened.units, [{ key: 'cm', name: 'Capital Markets Division' }]);
  assert.equal(reopened.assignments[2], 'unit:cm');
});
