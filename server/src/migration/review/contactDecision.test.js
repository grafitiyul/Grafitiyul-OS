import test from 'node:test';
import assert from 'node:assert/strict';
import { contactDraftFromProposal, resolveContactResult, contactDecisionFromDraft, batchDecisionFor } from './contactDecision.js';

const PAIR = {
  kind: 'contact_cluster',
  confidence: 'safe',
  members: [
    { legacyId: 1, name: 'דנה כהן', phones: ['050-1234567'], emails: ['dana@acme.com'], orgName: 'אקמה', dealCount: 5, activeDealCount: 2 },
    { legacyId: 2, name: 'דנה כהן', phones: ['+972501234567'], emails: ['dana.cohen@acme.com'], orgName: 'אקמה', dealCount: 2, activeDealCount: 0 },
  ],
  proposedPrimaryLegacyId: 1,
  proposedMergeLegacyIds: [2],
  proposedSeparateLegacyIds: [],
};
const SHARED = {
  confidence: 'shared',
  members: [
    { legacyId: 1, name: 'א', phones: ['03-6000000'], emails: [], dealCount: 3 },
    { legacyId: 2, name: 'ב', phones: ['03-6000000'], emails: [], dealCount: 1 },
    { legacyId: 3, name: 'ג', phones: ['03-6000000'], emails: [], dealCount: 0 },
  ],
  proposedPrimaryLegacyId: 1,
  proposedMergeLegacyIds: [],
  proposedSeparateLegacyIds: [2, 3],
};

test('the default draft follows the proposal', () => {
  const d = contactDraftFromProposal(PAIR);
  assert.equal(d.primaryLegacyId, 1);
  assert.equal(d.assignments[1], 'primary');
  assert.equal(d.assignments[2], 'merge');
});

test('a shared-number cluster defaults to keeping everyone SEPARATE', () => {
  const d = contactDraftFromProposal(SHARED);
  assert.equal(d.assignments[2], 'separate');
  assert.equal(d.assignments[3], 'separate');
  const r = resolveContactResult(SHARED, d);
  assert.equal(r.totals.contactsAfter, 3, 'nothing is merged by default');
  assert.equal(r.totals.mergedAway, 0);
});

test('the preview shows exactly what the surviving contact keeps (raw values)', () => {
  const d = contactDraftFromProposal(PAIR);
  const r = resolveContactResult(PAIR, d);
  assert.equal(r.primary.legacyId, 1);
  assert.deepEqual(r.primary.phones, ['050-1234567', '+972501234567'], 'both raw numbers survive, unmodified');
  assert.deepEqual(r.primary.emails, ['dana@acme.com', 'dana.cohen@acme.com']);
  assert.equal(r.primary.deals, 7, 'deals roll up');
  assert.equal(r.primary.activeDeals, 2);
  assert.deepEqual(r.primary.absorbs.map((a) => a.legacyId), [2]);
  assert.equal(r.totals.contactsBefore, 2);
  assert.equal(r.totals.contactsAfter, 1);
  assert.equal(r.valid, true);
});

test('the owner can choose a different primary', () => {
  const d = contactDraftFromProposal(PAIR);
  d.primaryLegacyId = 2;
  d.assignments = { 1: 'merge', 2: 'primary' };
  const r = resolveContactResult(PAIR, d);
  assert.equal(r.primary.legacyId, 2);
  assert.deepEqual(r.primary.absorbs.map((a) => a.legacyId), [1]);
  assert.equal(r.primary.deals, 7, 'totals are unchanged by which record survives');
});

test('the owner can split a record out instead of merging it', () => {
  const d = contactDraftFromProposal(PAIR);
  d.assignments[2] = 'separate';
  const r = resolveContactResult(PAIR, d);
  assert.equal(r.totals.contactsAfter, 2);
  assert.equal(r.totals.mergedAway, 0);
  assert.deepEqual(r.separate.map((s) => s.legacyId), [2]);
  assert.deepEqual(r.primary.phones, ['050-1234567'], 'the split record keeps its own number');
});

test('merging across different organisations is flagged as a warning, not blocked', () => {
  const cross = { ...PAIR, members: [PAIR.members[0], { ...PAIR.members[1], orgName: 'ארגון אחר' }] };
  const r = resolveContactResult(cross, contactDraftFromProposal(cross));
  assert.equal(r.valid, true);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /ארגונים שונים/);
});

test('a missing primary is invalid', () => {
  const r = resolveContactResult(PAIR, { primaryLegacyId: 999, assignments: {} });
  assert.equal(r.valid, false);
  assert.match(r.problems[0], /לא נבחר/);
});

test('the stored decision records primary / merged / separate explicitly', () => {
  const d = contactDraftFromProposal(PAIR);
  const stored = contactDecisionFromDraft(PAIR, d);
  assert.equal(stored.primaryLegacyId, 1);
  assert.deepEqual(stored.mergeLegacyIds, [2]);
  assert.deepEqual(stored.separateLegacyIds, []);
  assert.equal(stored.result.primary.deals, 7);
});

test('batch approval stores EXACTLY the proposal — it invents nothing', () => {
  const batch = batchDecisionFor(PAIR);
  const manual = contactDecisionFromDraft(PAIR, contactDraftFromProposal(PAIR));
  assert.deepEqual(batch, manual, 'a batch approval is identical to approving it by hand');
  assert.equal(batch.primaryLegacyId, PAIR.proposedPrimaryLegacyId);
  assert.deepEqual(batch.mergeLegacyIds, PAIR.proposedMergeLegacyIds);
});

test('re-opening a decided cluster restores the OWNER choice, not the proposal', () => {
  const d = contactDraftFromProposal(PAIR);
  d.primaryLegacyId = 2;
  d.assignments = { 1: 'separate', 2: 'primary' };
  const stored = contactDecisionFromDraft(PAIR, d);

  const reopened = contactDraftFromProposal(PAIR, stored);
  assert.equal(reopened.primaryLegacyId, 2);
  assert.equal(reopened.assignments[1], 'separate', 'the owner split survives re-open');
});
