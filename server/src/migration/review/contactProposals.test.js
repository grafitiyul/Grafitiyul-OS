import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactProposals, classifyCluster, pickPrimary, contactSubjectKey } from './contactProposals.js';
import { normalizeForCompare, isComparable } from '../phoneCompare.js';

const TODAY = '2026-07-15';
const c = (o) => ({
  legacyId: o.id, name: o.name || `${o.first || ''} ${o.last || ''}`.trim(),
  firstName: o.first ?? null, lastName: o.last ?? null,
  phones: o.phones || [], emails: o.emails || [],
  orgId: o.orgId ?? null, orgName: o.orgName ?? null,
  dealCount: o.deals || 0, activeDealCount: o.active || 0, futureTourDeals: o.tours || 0,
});
const build = (contacts) => buildContactProposals({ contacts, today: TODAY });

test('the queue holds CLUSTERS, never every contact', () => {
  const contacts = [
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-1234567'] }),
    c({ id: 2, first: 'דנה', last: 'כהן', phones: ['+972501234567'] }),
    // 3 contacts with no duplicate at all — they must NOT become decisions.
    c({ id: 3, first: 'רון', last: 'לוי', phones: ['052-1111111'] }),
    c({ id: 4, first: 'נועה', last: 'בר', phones: ['053-2222222'] }),
    c({ id: 5, first: 'אבי', last: 'גל', phones: [] }),
  ];
  const { proposals, stats } = build(contacts);
  assert.equal(proposals.length, 1, 'only the duplicate pair is a decision');
  assert.equal(stats.contacts, 5);
  assert.equal(proposals[0].members.length, 2);
});

test('phone formats normalise for COMPARISON only — raw values are preserved verbatim', () => {
  const { proposals } = build([
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-123-4567'] }),
    c({ id: 2, first: 'דנה', last: 'כהן', phones: ['+972 50 1234567'] }),
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].clusterKey, '972501234567', 'compared on the normalised candidate');
  // The members keep exactly what was typed — nothing is rewritten.
  assert.deepEqual(proposals[0].members.map((m) => m.phones[0]), ['050-123-4567', '+972 50 1234567']);
});

test('R2 repairs the +972-0 corruption; R7 foreign-looking numbers are NEVER repaired', () => {
  assert.equal(normalizeForCompare('+972 0 50-1234567').candidate, '972501234567');
  assert.equal(normalizeForCompare('9720501234567').rule, 'R2_9720_strip_zero');
  // Leading 0 with too many digits: a '+' probably became '0'. Never guess.
  const r7 = normalizeForCompare('0442071234567');
  assert.equal(r7.candidate, null);
  assert.equal(r7.confidence, 'review');
  assert.equal(isComparable(r7), false, 'un-comparable → can never form a cluster');
});

test('classification is the audit rule: same name → safe; name conflict → probable; +disjoint emails → ambiguous; >2 → shared', () => {
  const same = classifyCluster([c({ id: 1, first: 'דנה', last: 'כהן' }), c({ id: 2, first: 'דנה', last: 'כהן' })]);
  assert.equal(same.confidence, 'safe');

  const nameConflict = classifyCluster([c({ id: 1, first: 'דנה', last: 'כהן' }), c({ id: 2, first: 'דנית', last: 'לוי' })]);
  assert.equal(nameConflict.confidence, 'probable', 'different names, no conflicting emails');

  const bothEmails = classifyCluster([
    c({ id: 1, first: 'דנה', last: 'כהן', emails: ['dana@a.com'] }),
    c({ id: 2, first: 'רון', last: 'לוי', emails: ['ron@b.com'] }),
  ]);
  assert.equal(bothEmails.confidence, 'ambiguous', 'different names AND no shared email');

  const sharedEmail = classifyCluster([
    c({ id: 1, first: 'דנה', last: 'כהן', emails: ['dana@a.com'] }),
    c({ id: 2, first: 'D. Cohen', emails: ['dana@a.com'] }),
  ]);
  assert.equal(sharedEmail.confidence, 'safe', 'a shared email overrides a name difference');

  const shared = classifyCluster([c({ id: 1, first: 'א' }), c({ id: 2, first: 'ב' }), c({ id: 3, first: 'ג' })]);
  assert.equal(shared.confidence, 'shared');
});

test('a number shared by >2 contacts is NEVER proposed for merging', () => {
  const { proposals } = build([
    c({ id: 1, first: 'א', phones: ['03-6000000'], deals: 5 }),
    c({ id: 2, first: 'ב', phones: ['03-6000000'] }),
    c({ id: 3, first: 'ג', phones: ['03-6000000'] }),
  ]);
  const p = proposals[0];
  assert.equal(p.confidence, 'shared');
  assert.deepEqual(p.proposedMergeLegacyIds, [], 'nothing is proposed to merge');
  assert.equal(p.proposedSeparateLegacyIds.length, 2, 'they stay separate unless a human says otherwise');
  assert.equal(p.batchApprovable, false, 'never batch-approvable');
  assert.match(p.reason, /מרכזייה|משרד/);
});

test('ONLY safe clusters are batch-approvable', () => {
  const { proposals, stats } = build([
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-1111111'] }),
    c({ id: 2, first: 'דנה', last: 'כהן', phones: ['0501111111'] }),
    c({ id: 3, first: 'רון', phones: ['052-2222222'] }),
    c({ id: 4, first: 'רוני', phones: ['052-2222222'] }),
    c({ id: 5, first: 'א', phones: ['03-9999999'] }),
    c({ id: 6, first: 'ב', phones: ['03-9999999'] }),
    c({ id: 7, first: 'ג', phones: ['03-9999999'] }),
  ]);
  const byConf = Object.fromEntries(proposals.map((p) => [p.confidence, p]));
  assert.equal(byConf.safe.batchApprovable, true);
  assert.equal(byConf.probable.batchApprovable, false);
  assert.equal(byConf.shared.batchApprovable, false);
  assert.equal(stats.batchApprovable, 1);
  assert.equal(stats.needsIndividualReview, 2);
});

test('"New Contact" spam is excluded from dedup entirely', () => {
  const { proposals, stats } = build([
    c({ id: 1, first: 'New Contact', name: 'New Contact | 0501234567', phones: ['050-1234567'] }),
    c({ id: 2, first: 'New Contact', name: 'New Contact | 0501234567', phones: ['+972501234567'] }),
    c({ id: 3, first: 'דנה', last: 'כהן', phones: ['050-9999999'] }),
    c({ id: 4, first: 'דנה', last: 'כהן', phones: ['0509999999'] }),
  ]);
  assert.equal(stats.newContactSpamExcluded, 2);
  assert.equal(proposals.length, 1, 'only the real duplicate pair');
  assert.ok(!proposals[0].members.some((m) => /New Contact/i.test(m.name)));
});

test('exact-email duplicates are found even with no shared phone; role mailboxes are skipped', () => {
  const { proposals, stats } = build([
    c({ id: 1, first: 'דנה', last: 'כהן', emails: ['dana@acme.com'], phones: ['050-1111111'] }),
    c({ id: 2, first: 'דנה', last: 'כהן', emails: ['dana@acme.com'], phones: ['03-7777777'] }),
    // info@ shared by three people = a role mailbox, not a duplicate.
    c({ id: 3, first: 'א', emails: ['info@acme.com'] }),
    c({ id: 4, first: 'ב', emails: ['info@acme.com'] }),
    c({ id: 5, first: 'ג', emails: ['info@acme.com'] }),
  ]);
  assert.equal(stats.emailOnlyClusters, 1);
  assert.equal(stats.roleEmailClustersSkipped, 1, 'the role mailbox is not a decision');
  assert.equal(proposals[0].clusterKind, 'email');
  assert.equal(proposals[0].confidence, 'safe');
});

test('the primary keeps the most deals, then the most complete record', () => {
  const winner = pickPrimary([
    c({ id: 9, first: 'דנה', deals: 1 }),
    c({ id: 2, first: 'דנה', last: 'כהן', emails: ['d@a.com'], phones: ['050'], deals: 5 }),
  ]);
  assert.equal(winner.legacyId, 2);
  // Same deals → the more complete record wins.
  const byCompleteness = pickPrimary([
    c({ id: 9, first: 'דנה', deals: 2 }),
    c({ id: 2, first: 'דנה', last: 'כהן', emails: ['d@a.com'], deals: 2 }),
  ]);
  assert.equal(byCompleteness.legacyId, 2);
});

test('priority puts operationally-active clusters first; subject keys are stable', () => {
  const { proposals } = build([
    c({ id: 1, first: 'שקט', phones: ['050-1111111'], deals: 9 }),
    c({ id: 2, first: 'שקט', phones: ['0501111111'], deals: 9 }),
    c({ id: 3, first: 'פעיל', phones: ['052-2222222'], deals: 1, active: 3 }),
    c({ id: 4, first: 'פעיל', phones: ['0522222222'] }),
  ]);
  assert.equal(proposals[0].members[0].name, 'פעיל', 'active impact outranks deal count');
  assert.equal(proposals[0].rank, 1);
  assert.equal(contactSubjectKey(proposals[0]), 'contact:phone:972522222222');
});

test('evidence separates exact, inferred and conflicting signals', () => {
  const { proposals } = build([
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-1111111'], emails: ['a@x.com'], orgName: 'אקמה' }),
    c({ id: 2, first: 'רון', last: 'לוי', phones: ['0501111111'], emails: ['b@y.com'], orgName: 'אקמה' }),
  ]);
  const e = proposals[0].evidence;
  assert.ok(e.exact.some((x) => /טלפון/.test(x)));
  assert.ok(e.inferred.some((x) => /אותו ארגון/.test(x)));
  assert.ok(e.conflicts.some((x) => /שמות שונים/.test(x)));
  assert.ok(e.conflicts.some((x) => /אין אף כתובת אימייל/.test(x)));
});
