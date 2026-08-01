import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normName, normTaxId, normPhone, dateCompatible, dateDistanceDays, amountsEqual,
  resolveDocumentIdentity, buildCandidates, assignTiers, detectSharedDocument, scoreCandidate,
} from './collectionMatcher.js';

// The second stage links documents that no deal ever named. Its whole safety
// rests on ONE rule: automatic only on mutual uniqueness under an exact amount.
// These tests exist to make that rule hard to weaken by accident.

const idx = (over = {}) => ({
  clientIdToCustomers: new Map(),
  taxIdToCustomers: new Map(),
  nameToCustomers: new Map(),
  ...over,
});

const doc = (over = {}) => ({
  doctype: 'invrec',
  docnum: '38474',
  clientId: null,
  clientName: 'עיריית אור יהודה',
  clientVatId: null,
  currency: 'ILS',
  totalMinor: 100_000,
  paidMinor: 100_000,
  issuedAt: '2026-05-01T00:00:00.000Z',
  ...over,
});

const deal = (over = {}) => ({
  id: 'deal-1',
  orderNo: 26000,
  valueMinor: 100_000,
  currency: 'ILS',
  createdAt: '2026-04-01T00:00:00.000Z',
  wonAt: '2026-04-10T00:00:00.000Z',
  tourDate: '2026-05-05',
  ...over,
});

// ── Normalisation ───────────────────────────────────────────────────────────

test('names normalise past gershayim, spacing and punctuation', () => {
  assert.equal(normName('גרפיטיול בע"מ'), normName('גרפיטיול בע״מ'));
  assert.equal(normName('  Mabat   Platinum '), normName('mabat-platinum'));
});

test('normalisation does not collapse different customers', () => {
  assert.notEqual(normName('עמותת שורשים'), normName('עמותת שורש'));
});

test('tax ids and phones reduce to comparable digits', () => {
  assert.equal(normTaxId('51-160364-9'), '511603649');
  assert.equal(normPhone('+972-50-123-4567'), '0501234567');
  assert.equal(normPhone('050-1234567'), '0501234567');
  assert.equal(normPhone('123'), ''); // too short to be an identity
});

// ── Dates ───────────────────────────────────────────────────────────────────

test('a document issued near the tour is compatible; one years away is not', () => {
  assert.equal(dateCompatible('2026-05-01T00:00:00.000Z', deal()), true);
  assert.equal(dateCompatible('2026-01-05T00:00:00.000Z', deal()), true); // deposit, before creation
  assert.equal(dateCompatible('2022-01-01T00:00:00.000Z', deal()), false);
  assert.equal(dateCompatible('2030-01-01T00:00:00.000Z', deal()), false);
});

test('date distance measures against the nearest anchor', () => {
  assert.equal(dateDistanceDays('2026-05-05T00:00:00.000Z', deal()), 0);
});

test('amount equality is exact, absorbing only VAT rounding', () => {
  assert.equal(amountsEqual(100_000, 100_007), true);
  assert.equal(amountsEqual(100_000, 100_500), false);
});

// ── Identity ────────────────────────────────────────────────────────────────

test('a learned iCount client id resolves identity', () => {
  const i = idx({ clientIdToCustomers: new Map([['33795', ['org:o1']]]) });
  const r = resolveDocumentIdentity(doc({ clientId: '33795' }), i);
  assert.deepEqual(r, [{ customerKey: 'org:o1', basis: 'icount_client_id' }]);
});

test('an exact normalised name resolves identity', () => {
  const i = idx({ nameToCustomers: new Map([[normName('עיריית אור יהודה'), ['org:o2']]]) });
  assert.equal(resolveDocumentIdentity(doc(), i)[0].basis, 'exact_name');
});

test('no identity signal → no candidates at all (Tier C, never queued)', () => {
  assert.deepEqual(resolveDocumentIdentity(doc({ clientName: 'לקוח לא מוכר' }), idx()), []);
  assert.deepEqual(buildCandidates(doc({ clientName: 'לקוח לא מוכר' }), idx(), { dealsByCustomer: new Map() }), []);
});

// ── Candidates ──────────────────────────────────────────────────────────────

const oneCustomerIdx = idx({ nameToCustomers: new Map([[normName('עיריית אור יהודה'), ['org:o1']]]) });

test('currencies never mix, whatever the identity says', () => {
  const c = buildCandidates(doc({ currency: 'USD' }), oneCustomerIdx, {
    dealsByCustomer: new Map([['org:o1', [deal()]]]),
  });
  assert.equal(c.length, 0);
});

test('a document outside the date window is not a candidate', () => {
  const c = buildCandidates(doc({ issuedAt: '2020-01-01T00:00:00.000Z' }), oneCustomerIdx, {
    dealsByCustomer: new Map([['org:o1', [deal()]]]),
  });
  assert.equal(c.length, 0);
});

// ── Tiers — the safety rule ─────────────────────────────────────────────────

function tiersFor(candidatesByDoc) {
  const docCandidates = new Map(Object.entries(candidatesByDoc));
  const dealCandidates = new Map();
  for (const list of Object.values(candidatesByDoc)) {
    for (const c of list) {
      if (!dealCandidates.has(c.dealId)) dealCandidates.set(c.dealId, []);
      dealCandidates.get(c.dealId).push(c);
    }
  }
  return assignTiers({ docCandidates, dealCandidates });
}

const cand = (over = {}) => ({
  dealId: 'deal-1', orderNo: 26000, dealValueMinor: 100_000,
  doctype: 'invrec', docnum: '38474', docMoneyMinor: 100_000,
  basis: 'exact_name', exactAmount: true, partial: false, over: false, days: 4,
  reasons: [], score: 85, ...over,
});

test('TIER A only when the document and the deal are each other\'s ONLY exact match', () => {
  const { tierA, tierB } = tiersFor({ 'invrec:38474': [cand()] });
  assert.equal(tierA.length, 1);
  assert.equal(tierB.length, 0);
  assert.ok(tierA[0].reasons.some((r) => r.code === 'mutual_unique_exact_amount'));
});

test('one document, two exactly-matching deals → NEVER automatic', () => {
  const { tierA, tierB } = tiersFor({
    'invrec:38474': [cand(), cand({ dealId: 'deal-2', orderNo: 26001 })],
  });
  assert.equal(tierA.length, 0);
  assert.equal(tierB.length, 2);
  assert.ok(tierB[0].question.includes('עסקאות אחרות'));
});

test('one deal, two exactly-matching documents → NEVER automatic', () => {
  const { tierA, tierB } = tiersFor({
    'invrec:38474': [cand()],
    'invrec:38475': [cand({ docnum: '38475' })],
  });
  assert.equal(tierA.length, 0);
  assert.equal(tierB.length, 2);
  assert.ok(tierB[0].competingDocs.length >= 1);
});

test('identity + a matching amount is not enough without exactness', () => {
  const { tierA, tierB } = tiersFor({
    'invrec:38474': [cand({ exactAmount: false, partial: true, docMoneyMinor: 30_000 })],
  });
  assert.equal(tierA.length, 0);
  assert.equal(tierB.length, 1);
  assert.ok(tierB[0].question.includes('מקדמה'));
});

test('a Tier B item always carries the exact question and the competitors', () => {
  const { tierB } = tiersFor({ 'invrec:38474': [cand(), cand({ dealId: 'deal-2', orderNo: 26001 })] });
  const item = tierB[0];
  assert.ok(item.question.length > 10);
  assert.equal(item.competingDeals[0].orderNo, 26001);
  assert.equal(item.tier, 'B');
});

// ── Scoring ─────────────────────────────────────────────────────────────────

test('scoring is deterministic and identity-led', () => {
  const a = scoreCandidate({ basis: 'icount_client_id', exactAmount: true, days: 3 });
  const b = scoreCandidate({ basis: 'exact_name', exactAmount: true, days: 3 });
  const c = scoreCandidate({ basis: 'exact_name', exactAmount: false, partial: true, days: 300 });
  assert.ok(a > b && b > c);
  assert.equal(a, scoreCandidate({ basis: 'icount_client_id', exactAmount: true, days: 3 }));
});

// ── Shared historical documents ─────────────────────────────────────────────

test('a document whose candidate deals SUM to it is a shared historical document', () => {
  const shared = detectSharedDocument(300_000, [
    cand({ dealId: 'a', dealValueMinor: 100_000 }),
    cand({ dealId: 'b', dealValueMinor: 120_000 }),
    cand({ dealId: 'c', dealValueMinor: 80_000 }),
  ]);
  assert.equal(shared.deals.length, 3);
  assert.equal(shared.sumMinor, 300_000);
  // Each deal is settled by its OWN value — never by the document's total.
  assert.deepEqual(shared.deals.map((d) => d.allocationMinor), [100_000, 120_000, 80_000]);
});

test('merely being bigger than several deals is NOT a shared document', () => {
  assert.equal(detectSharedDocument(300_000, [
    cand({ dealId: 'a', dealValueMinor: 100_000 }),
    cand({ dealId: 'b', dealValueMinor: 50_000 }),
  ]), null);
});

test('a single candidate is never a shared document', () => {
  assert.equal(detectSharedDocument(100_000, [cand()]), null);
});
