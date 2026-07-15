import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExceptions, EXCEPTION_KINDS, exceptionSubjectKey } from './exceptions.js';
import { buildReadiness } from './readiness.js';

const TODAY = '2026-07-15';
const base = {
  deals: [], today: TODAY, personIds: new Set(), excludedOrgIds: new Set(), spamPersonIds: new Set(),
  spamContactsWithDeals: [], strippedContacts: [], nameExclusions: [],
  brokenTourLinks: [], brokenCollectionLinks: [],
};
const deal = (o) => ({
  id: o.id, title: o.title || `deal ${o.id}`, status: o.status || 'won', archived: !!o.archived,
  personId: o.personId ?? null, orgId: o.orgId ?? null, orgName: o.orgName ?? null, personName: o.personName ?? null,
  tourDate: o.tourDate ?? null, value: o.value ?? 0, isActive: !!o.isActive,
});

test('an archived OPEN deal is an exception — it would be skipped in silence', () => {
  const { exceptions } = buildExceptions({
    ...base,
    deals: [deal({ id: 1, status: 'open', archived: true, value: 1650, tourDate: '2023-12-09' }), deal({ id: 2, status: 'open' }), deal({ id: 3, status: 'won', archived: true })],
  });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].exceptionKind, 'archived_open_deal');
  assert.equal(exceptions[0].blocksIdentity, false, 'a deal anomaly cannot block IDENTITY import');
});

test('normal validation warnings are NOT exceptions', () => {
  // A private customer with no organisation is ordinary (194 active deals in
  // Snapshot #1 look like this). It must never appear here.
  const { exceptions } = buildExceptions({
    ...base,
    personIds: new Set([10]),
    deals: [deal({ id: 1, status: 'open', isActive: true, personId: 10, orgId: null })],
  });
  assert.equal(exceptions.length, 0, 'no org on a private deal is normal, not exceptional');
});

test('an active deal pointing at an EXCLUDED organisation blocks identity', () => {
  const { exceptions, stats } = buildExceptions({
    ...base,
    personIds: new Set([10]),
    excludedOrgIds: new Set([99]),
    deals: [deal({ id: 1, isActive: true, personId: 10, orgId: 99, orgName: 'junk' })],
  });
  assert.equal(exceptions[0].exceptionKind, 'active_deal_excluded_org');
  assert.equal(exceptions[0].blocksIdentity, true, 'the destination will not exist');
  assert.equal(stats.blocksIdentity, 1);
});

test('an active deal whose contact does not exist blocks identity; a missing contact link does not', () => {
  const { exceptions } = buildExceptions({
    ...base,
    personIds: new Set([10]),
    deals: [deal({ id: 1, isActive: true, personId: 777 }), deal({ id: 2, isActive: true, personId: null })],
  });
  const byKind = Object.fromEntries(exceptions.map((e) => [e.exceptionKind, e]));
  assert.equal(byKind.active_deal_dead_contact.blocksIdentity, true, 'the target id resolves to nothing');
  assert.equal(byKind.active_deal_no_contact.blocksIdentity, false, 'no link at all is a deal-import problem');
});

test('a correction that strips a contact of all identity is an exception ONLY when the deals are live', () => {
  const live = buildExceptions({ ...base, strippedContacts: [{ legacyId: 1, name: 'x', activeDealCount: 2 }] });
  assert.equal(live.exceptions.length, 1);
  assert.equal(live.exceptions[0].blocksIdentity, true);
  const dead = buildExceptions({ ...base, strippedContacts: [{ legacyId: 1, name: 'x', activeDealCount: 0 }] });
  assert.equal(dead.exceptions.length, 0, 'closed history needs no placeholder');
});

test('a name-cleanup exclusion is an exception only when it strands a LIVE deal', () => {
  const live = buildExceptions({ ...base, nameExclusions: [{ legacyId: 1, displayName: 'x', openDealCount: 1, futureTourDeals: 0, operationallyActive: true }] });
  assert.equal(live.exceptions[0].exceptionKind, 'name_exclusion_with_active_deals');
  assert.equal(live.exceptions[0].blocksIdentity, true);
  const dead = buildExceptions({ ...base, nameExclusions: [{ legacyId: 2, displayName: 'y', openDealCount: 0, futureTourDeals: 0, operationallyActive: false }] });
  assert.equal(dead.exceptions.length, 0);
});

test('broken Airtable → Pipedrive links are reported but never block identity', () => {
  const { exceptions, stats } = buildExceptions({
    ...base,
    brokenTourLinks: [{ airtableId: 'recA', entity: 'airtable/main/t1', dealId: 17464, name: 'tour' }],
    brokenCollectionLinks: [{ airtableId: 'recB', entity: 'airtable/main/t2', dealId: 23961, name: 'pay' }],
  });
  assert.equal(exceptions.length, 2);
  assert.equal(stats.blocksIdentity, 0, 'tours and money are later slices, not identity');
  assert.ok(exceptions.every((e) => e.choices.includes('archive_only')));
});

test('each (kind, subject) yields exactly one row, and identity blockers sort first', () => {
  const { exceptions } = buildExceptions({
    ...base,
    personIds: new Set([10]),
    excludedOrgIds: new Set([99]),
    deals: [
      deal({ id: 1, status: 'open', archived: true }),
      deal({ id: 2, isActive: true, personId: 10, orgId: 99 }),
    ],
  });
  assert.equal(exceptions[0].blocksIdentity, true, 'blockers first');
  assert.equal(new Set(exceptions.map((e) => exceptionSubjectKey(e.exceptionKind, e.subjectId))).size, exceptions.length);
});

test('categories that were checked and came back clean are reported explicitly', () => {
  const { stats } = buildExceptions(base);
  assert.equal(stats.total, 0);
  // "we looked and found nothing" must be distinguishable from "we did not look".
  assert.deepEqual(stats.checkedAndClean.sort(), Object.keys(EXCEPTION_KINDS).sort());
});

// ── readiness ────────────────────────────────────────────────────────────────
const facts = (o = {}) => ({
  orgs: { total: 10, resolved: 10 },
  stageConfigCount: 32,
  contactSections: { critical: { unresolved: 0 }, historicalUnresolved: 359 },
  nameStats: { criticalUnresolved: 0, blockingUnresolved: 0, historicalUnresolved: 147 },
  exceptionStats: { blockingUnresolved: 0, nonBlockingUnresolved: 62 },
  implicitMergeCount: 0,
  identityEditsApplied: true,
  participantGapResolved: true,
  shellExclusionCount: 406,
  ...o,
});

test('the gate is data-driven and reports every requirement', () => {
  const r = buildReadiness(facts());
  assert.equal(r.ready, true);
  assert.equal(r.blockers.length, 0);
  assert.ok(r.requirements.length >= 8);
});

test('HISTORICAL work never blocks the import — that is the owner-approved rule', () => {
  const r = buildReadiness(facts());
  assert.equal(r.ready, true, '359 undecided historical clusters + 147 historical names must NOT block');
  assert.ok(r.informational.some((i) => /359/.test(i.detail)));
  assert.ok(r.informational.every((i) => i.blocking === false));
});

test('a non-blocking exception never closes the gate; a blocking one does', () => {
  assert.equal(buildReadiness(facts({ exceptionStats: { blockingUnresolved: 0, nonBlockingUnresolved: 62 } })).ready, true);
  const blocked = buildReadiness(facts({ exceptionStats: { blockingUnresolved: 1, nonBlockingUnresolved: 62 } }));
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers[0].key, 'exceptions_blocking');
});

test('the gate closes on each real risk, and says which', () => {
  for (const [key, override] of [
    ['organizations', { orgs: { total: 10, resolved: 9 } }],
    ['contacts_critical', { contactSections: { critical: { unresolved: 3 }, historicalUnresolved: 0 } }],
    ['name_cleanup_critical', { nameStats: { criticalUnresolved: 2, blockingUnresolved: 0, historicalUnresolved: 0 } }],
    ['name_cleanup_critical', { nameStats: { criticalUnresolved: 0, blockingUnresolved: 5, historicalUnresolved: 0 } }],
    ['no_implicit_merge', { implicitMergeCount: 1 }],
    ['corrections_applied', { identityEditsApplied: false }],
    ['participant_gap', { participantGapResolved: false }],
    ['stage_config', { stageConfigCount: 0 }],
  ]) {
    const r = buildReadiness(facts(override));
    assert.equal(r.ready, false, `${key} must close the gate`);
    assert.ok(r.blockers.some((b) => b.key === key), `${key} must be named as the blocker`);
    assert.ok(r.blockers.every((b) => b.detail), 'every blocker explains itself');
  }
});

test('the unresolved participant question keeps the gate closed while shells are excluded', () => {
  const r = buildReadiness(facts({ participantGapResolved: false, shellExclusionCount: 406 }));
  assert.equal(r.ready, false);
  const b = r.blockers.find((x) => x.key === 'participant_gap');
  assert.match(b.detail, /406/);
  assert.match(b.detail, /478/, 'the exact unmeasured exposure is named');
});
