import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactProposals, classifyCluster, pickPrimary, contactSubjectKey, nameClass } from './contactProposals.js';
import { normalizeForCompare, isComparable } from '../phoneCompare.js';

const TODAY = '2026-07-15';
const c = (o) => ({
  legacyId: o.id, name: o.name || `${o.first || ''} ${o.last || ''}`.trim(),
  firstName: o.first ?? null, lastName: o.last ?? null,
  phones: o.phones || [], emails: o.emails || [],
  orgId: o.orgId ?? null, orgName: o.orgName ?? null,
  dealCount: o.deals || 0, activeDealCount: o.active || 0, futureTourDeals: o.tours || 0,
  openDealCount: o.open || 0, wonRecentDealCount: o.wonRecent || 0,
  activityCount: o.acts || 0, noteCount: o.notes || 0, fileCount: o.files || 0,
  participantCount: o.parts || 0,
});
const build = (contacts) => buildContactProposals({ contacts, today: TODAY });
const only = (contacts) => build(contacts).proposals[0];

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

test('classification: same name → safe; name conflict → probable; +disjoint emails → ambiguous; >2 → shared', () => {
  const same = classifyCluster([c({ id: 1, first: 'דנה', last: 'כהן' }), c({ id: 2, first: 'דנה', last: 'כהן' })]);
  assert.equal(same.confidence, 'safe');

  const nameConflict = classifyCluster([c({ id: 1, first: 'דנה', last: 'כהן' }), c({ id: 2, first: 'דנית', last: 'לוי' })]);
  assert.equal(nameConflict.confidence, 'probable', 'different names, no conflicting emails');

  const bothEmails = classifyCluster([
    c({ id: 1, first: 'דנה', last: 'כהן', emails: ['dana@a.com'] }),
    c({ id: 2, first: 'רון', last: 'לוי', emails: ['ron@b.com'] }),
  ]);
  assert.equal(bothEmails.confidence, 'ambiguous', 'different names AND no shared email');

  // A shared email is INDEPENDENT evidence for a PHONE cluster — the phone is the key.
  const sharedEmail = classifyCluster([
    c({ id: 1, first: 'דנה', last: 'כהן', emails: ['dana@a.com'] }),
    c({ id: 2, first: 'D. Cohen', emails: ['dana@a.com'] }),
  ], 'phone');
  assert.equal(sharedEmail.confidence, 'safe', 'a shared email corroborates a shared phone');

  const shared = classifyCluster([c({ id: 1, first: 'א' }), c({ id: 2, first: 'ב' }), c({ id: 3, first: 'ג' })]);
  assert.equal(shared.confidence, 'shared');

  // A record with no name at all is never "identical" to another.
  const nameless = classifyCluster([c({ id: 1, first: 'דנה', last: 'כהן' }), c({ id: 2, name: '' })]);
  assert.equal(nameless.confidence, 'probable', 'a missing name is a conflict, not a match');
});

// ── THE CORROBORATION PRINCIPLE ────────────────────────────────────────────────
// The regression that started the whole contacts audit. Two DIFFERENT people share
// one free-mail address. The old rule read `!nameConflict || shareEmail → safe`, and
// for an email cluster `shareEmail` is true by construction — so the pair was SAFE
// and one batch-approve away from being merged. It must never be auto-merged again.
//
// Every fixture in this file is SYNTHETIC. The bugs they pin were found in real
// legacy records, but this repo is public: reproduce the SHAPE, never the person.
test('a cluster key can NEVER be its own evidence: shared email + different names is not safe', () => {
  const p = only([
    c({ id: 1, first: 'איתי', last: 'רון', emails: ['shared@yahoo.com'], phones: ['972500000001'], deals: 2 }),
    c({ id: 2, first: 'מיכל', last: 'אבן', emails: ['shared@yahoo.com'], phones: ['972500000002'], deals: 2 }),
  ]);
  assert.equal(p.clusterKind, 'email');
  assert.equal(p.batchApprovable, false, 'NEVER auto-merged');
  assert.notEqual(p.confidence, 'safe');
  assert.deepEqual(p.proposedMergeLegacyIds, [], 'an unreviewed cluster carries no latent merge');
  assert.equal(p.proposedSeparateLegacyIds.length, 1, 'the default is: import both separately');
  // The evidence must not list the key as corroboration of itself.
  assert.ok(!p.evidence.exact.some((x) => /משותפת/.test(x)), 'the shared address is the key, not evidence');
  assert.ok(p.evidence.conflicts.some((x) => /טלפון/.test(x)), 'the differing phones ARE evidence');
});

test('free-mail and role mailboxes never carry a merge on their own', () => {
  // Same free-mail address + a name typo: gmail is shared by households, so the
  // corporate-email promotion rules must not fire.
  const free = only([
    c({ id: 1, first: 'נועה', last: 'גרינברג', emails: ['fam@gmail.com'], phones: ['050-1111111'] }),
    c({ id: 2, first: 'נועה', last: 'גרינברגר', emails: ['fam@gmail.com'], phones: ['052-2222222'] }),
  ]);
  assert.equal(free.batchApprovable, false, 'a free-mail address is not proof of one identity');
});

test('SAFE promotions fire only with an independent signal and no dissent', () => {
  // R1 — same phone, one-letter typo.
  const typo = only([
    c({ id: 1, first: 'אורית', last: 'לבנון', phones: ['050-1111111'] }),
    c({ id: 2, first: 'אורית', last: 'לבנן', phones: ['0501111111'] }),
  ]);
  assert.equal(typo.batchApprovable, true);
  assert.match(typo.reason, /הקלדה/);

  // R2 — same phone, the name is merely completed.
  const completion = only([
    c({ id: 1, first: 'שירה', phones: ['050-3333333'] }),
    c({ id: 2, first: 'שירה', last: 'אלמוג', phones: ['0503333333'] }),
  ]);
  assert.equal(completion.batchApprovable, true);

  // A different organisation VETOES the promotion — colleagues share office lines.
  const orgDissent = only([
    c({ id: 1, first: 'אורית', last: 'לבנון', phones: ['050-4444444'], orgId: 10, orgName: 'ארגון א' }),
    c({ id: 2, first: 'אורית', last: 'לבנן', phones: ['0504444444'], orgId: 20, orgName: 'ארגון ב' }),
  ]);
  assert.equal(orgDissent.batchApprovable, false, 'a conflicting organisation vetoes the merge');
  assert.match(orgDissent.reason, /ארגונים שונים/);

  // Disjoint emails VETO it too.
  const emailDissent = only([
    c({ id: 1, first: 'שירה', phones: ['050-5555555'], emails: ['a@x.com'] }),
    c({ id: 2, first: 'שירה', last: 'אלמוג', phones: ['0505555555'], emails: ['b@y.com'] }),
  ]);
  assert.equal(emailDissent.batchApprovable, false);
});

test('a long name tail is NOT a name completion — organisations and couples stay in REVIEW', () => {
  // The measured worst cases of the unconstrained subset rule, reproduced in shape:
  // an organisation typed into the name field, and a couple in one record.
  assert.equal(nameClass({ name: 'דנה' }, { name: 'דנה מחלקת רכש ראשית' }), 'subset-long');
  assert.equal(nameClass({ name: 'תמר' }, { name: 'תמר ויוסי כרמל' }), 'subset-long');
  // One added token IS a completion.
  assert.equal(nameClass({ name: 'רותי' }, { name: 'רותי כרמל' }), 'subset');
  assert.equal(nameClass({ name: 'ענת בר' }, { name: 'ענת שני בר' }), 'subset');

  const couple = only([
    c({ id: 1, first: 'תמר', phones: ['050-6666666'] }),
    c({ id: 2, first: 'תמר ויוסי', last: 'כרמל', phones: ['0506666666'] }),
  ]);
  assert.equal(couple.batchApprovable, false, 'a couple is not one person');
  assert.match(couple.reason, /ארגון או זוג/);
});

test('a name that is not a name (an email, a company) can never testify to identity', () => {
  assert.equal(nameClass({ name: 'יעל נחום' }, { name: 'contact@example.org' }), 'not-a-name');
  assert.equal(nameClass({ name: 'אבי שלום' }, { name: 'Northbound Travel Ltd' }), 'cross-script');
  const p = only([
    c({ id: 1, first: 'יעל', last: 'נחום', phones: ['050-7777777'] }),
    c({ id: 2, name: 'contact@example.org', phones: ['0507777777'] }),
  ]);
  assert.equal(p.batchApprovable, false);
  assert.match(p.reason, /כתובת אימייל או שם חברה/);
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
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-1111111'], emails: ['a@x.com'], orgId: 7, orgName: 'אקמה' }),
    c({ id: 2, first: 'רון', last: 'לוי', phones: ['0501111111'], emails: ['b@y.com'], orgId: 7, orgName: 'אקמה' }),
  ]);
  const e = proposals[0].evidence;
  assert.ok(e.exact.some((x) => /טלפון/.test(x)));
  assert.ok(e.inferred.some((x) => /אותו ארגון/.test(x)));
  assert.ok(e.conflicts.some((x) => /שמות שונים/.test(x)));
  assert.ok(e.conflicts.some((x) => /אין אף כתובת אימייל/.test(x)));
});

// ── BUSINESS-IMPACT SECTIONS ───────────────────────────────────────────────────
// The engine knows which clusters can actually hurt. The queue must not bury them.

// A contact can be a SECONDARY PARTICIPANT on someone else's deal while owning no
// deal, activity, note or file. Snapshot #1 originally never extracted those links,
// so such a contact looked empty and would have been dropped in silence. The links
// were extracted on 2026-07-16; a participant link IS business value.
test('a secondary participant is NOT an empty shell', () => {
  const p = only([
    c({ id: 1, first: 'רון', last: 'לוי', phones: ['050-1111111'], deals: 12 }),
    c({ id: 2, first: 'שרה', last: 'בר', phones: ['0501111111'], parts: 1 }), // participant only
  ]);
  assert.equal(p.importableCount, 2, 'a participant link makes the contact importable');
  assert.equal(p.decisionRequired, true, 'so this IS a real duplicate the owner must judge');
  assert.notEqual(p.section, 'none');
  assert.equal(p.members.find((m) => m.legacyId === 2).participantCount, 1);
  assert.equal(p.members.find((m) => m.legacyId === 2).importable, true);

  // Without the link it is genuinely empty and costs nothing.
  const shell = only([
    c({ id: 3, first: 'רון', last: 'לוי', phones: ['052-2222222'], deals: 12 }),
    c({ id: 4, first: 'שרה', last: 'בר', phones: ['0522222222'] }),
  ]);
  assert.equal(shell.importableCount, 1);
  assert.equal(shell.section, 'none');
});

test('a cluster with <2 importable members needs NO decision and never enters the queue', () => {
  // A real contact + an empty shell. The shell is archived, never created in GOS,
  // so no duplicate can exist — even though the names conflict and this WOULD
  // otherwise be a review item. This is what dissolves most of the queue.
  const shell = only([
    c({ id: 1, first: 'רון', last: 'לוי', phones: ['050-1111111'], deals: 12 }),
    c({ id: 2, first: 'שרה', last: 'בר', phones: ['0501111111'] }), // nothing attached
  ]);
  assert.equal(shell.batchApprovable, false, 'not safe — the names genuinely conflict');
  assert.equal(shell.importableCount, 1);
  assert.equal(shell.decisionRequired, false, 'but there is still nothing to decide');
  assert.equal(shell.section, 'none');

  // Both empty → the cluster disappears entirely.
  const both = only([
    c({ id: 3, first: 'אבי', last: 'בר', phones: ['052-2222222'] }),
    c({ id: 4, first: 'גדי', last: 'דן', phones: ['0522222222'] }),
  ]);
  assert.equal(both.importableCount, 0);
  assert.equal(both.section, 'none');
});

test('sections route by business impact: open deal / future tour first', () => {
  const critical = only([
    c({ id: 1, first: 'א', last: 'א', phones: ['050-1111111'], deals: 2, open: 1 }),
    c({ id: 2, first: 'ב', last: 'ב', phones: ['0501111111'], deals: 1 }),
  ]);
  assert.equal(critical.section, 'critical');

  const tour = only([
    c({ id: 3, first: 'ג', last: 'ג', phones: ['052-2222222'], deals: 2, tours: 1 }),
    c({ id: 4, first: 'ד', last: 'ד', phones: ['0522222222'], deals: 1 }),
  ]);
  assert.equal(tour.section, 'critical', 'a future tour is live operations too');

  const recent = only([
    c({ id: 5, first: 'ה', last: 'ה', phones: ['053-3333333'], deals: 2, wonRecent: 1 }),
    c({ id: 6, first: 'ו', last: 'ו', phones: ['0533333333'], deals: 1 }),
  ]);
  assert.equal(recent.section, 'recent');

  const historical = only([
    c({ id: 7, first: 'ז', last: 'ז', phones: ['054-4444444'], deals: 3 }),
    c({ id: 8, first: 'ח', last: 'ח', phones: ['0544444444'], deals: 1 }),
  ]);
  assert.equal(historical.section, 'historical');

  const low = only([
    c({ id: 9, first: 'ט', last: 'ט', phones: ['055-5555555'], acts: 2 }),
    c({ id: 10, first: 'י', last: 'י', phones: ['0555555555'], notes: 1 }),
  ]);
  assert.equal(low.section, 'low', 'no deals, but real history');
});

test('a SAFE cluster is never routed to a review section — it is merged automatically', () => {
  const p = only([
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-1111111'], deals: 2, open: 1 }),
    c({ id: 2, first: 'דנה', last: 'כהן', phones: ['0501111111'], deals: 1 }),
  ]);
  assert.equal(p.batchApprovable, true);
  assert.equal(p.section, 'safe', 'an open deal does not make a certain duplicate the owner\'s problem');
  assert.equal(p.decisionRequired, false);
});

test('the queue is ordered by business impact, not alphabetically', () => {
  const { proposals } = build([
    // historical
    c({ id: 1, first: 'א', last: 'א', phones: ['050-1111111'], deals: 9 }),
    c({ id: 2, first: 'ב', last: 'ב', phones: ['0501111111'], deals: 9 }),
    // critical — fewer deals, but live
    c({ id: 3, first: 'ג', last: 'ג', phones: ['052-2222222'], deals: 1, open: 1 }),
    c({ id: 4, first: 'ד', last: 'ד', phones: ['0522222222'], deals: 1 }),
  ]);
  assert.equal(proposals[0].section, 'critical', 'live business outranks 9 closed deals');
  assert.equal(proposals[0].rank, 1);
});

test('stats report the owner workload the sections are built on', () => {
  const { stats } = build([
    c({ id: 1, first: 'דנה', last: 'כהן', phones: ['050-1111111'], deals: 2 }),
    c({ id: 2, first: 'דנה', last: 'כהן', phones: ['0501111111'], deals: 1 }),   // safe
    c({ id: 3, first: 'רון', last: 'לוי', phones: ['052-2222222'], deals: 2 }),
    c({ id: 4, first: 'שרה', last: 'בר', phones: ['0522222222'], deals: 1 }),    // historical
    c({ id: 5, first: 'א', last: 'ב', phones: ['053-3333333'], deals: 4 }),
    c({ id: 6, first: 'ג', last: 'ד', phones: ['0533333333'] }),                 // none (1 importable)
  ]);
  assert.equal(stats.bySection.safe, 1);
  assert.equal(stats.bySection.historical, 1);
  assert.equal(stats.bySection.none, 1);
  assert.equal(stats.decisionRequired, 1, 'only ONE cluster actually needs the owner');
  assert.equal(stats.noDecisionRequired, 1);
});
