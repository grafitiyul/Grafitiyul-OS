import test from 'node:test';
import assert from 'node:assert/strict';
import { decideDeal, referencesForDeal, customerMatches, dealIdentityOf } from './collectionBackfill.js';

// The historical reconstruction POLICY. What matters here is not that it
// classifies a lot of deals, but that it refuses to classify the ambiguous ones:
// a wrong automatic answer silently corrupts the books, while a review flag
// costs one operator glance.

const ledgerDoc = (doctype, docnum, over = {}) => ({
  doctype,
  docnum,
  issuedAt: new Date('2026-05-01T00:00:00.000Z'),
  clientName: 'עיריית אור יהודה',
  clientVatId: null,
  currency: 'ILS',
  totalMinor: 100_000n,
  paidMinor: null,
  isCancelled: false,
  isCancellation: false,
  syncedAt: new Date(),
  raw: {},
  ...over,
});

function makeLedger(docs) {
  const byKey = new Map();
  const byNum = new Map();
  for (const d of docs) {
    byKey.set(`${d.doctype}:${d.docnum}`, d);
    if (!byNum.has(d.docnum)) byNum.set(d.docnum, []);
    byNum.get(d.docnum).push(d);
  }
  return { byKey, byNum };
}

const deal = (over = {}) => ({
  id: 'deal-1',
  orderNo: 26000,
  title: 'סיור עיריית אור יהודה',
  valueMinor: 100_000n,
  currency: 'ILS',
  organization: { name: 'עיריית אור יהודה', taxId: null },
  organizationUnit: null,
  contacts: [],
  ...over,
});

const run = (texts, docs, over = {}, claimsOver = null) => {
  const references = referencesForDeal(texts.map((t) => ({ text: t, source: 'note' })));
  const ledger = makeLedger(docs);
  const claims = claimsOver || new Map(docs.map((d) => [`${d.doctype}:${d.docnum}`, ['deal-1']]));
  return decideDeal({ deal: deal(over), references, ledger, claims });
};

test('a typed receipt reference attaches and closes the deal', () => {
  const d = run(['חשבונית מס קבלה 38474'], [ledgerDoc('invrec', '38474')]);
  assert.equal(d.attach.length, 1);
  assert.equal(d.attach[0].linkConfidence, 'note_typed_number');
  assert.equal(d.outcome, 'paid');
  assert.equal(d.review, null);
});

test('a bare number that resolves to exactly one document is accepted', () => {
  const d = run(['המסמך נוצר בהצלחה מספר 38474'], [ledgerDoc('invrec', '38474')]);
  assert.equal(d.attach.length, 1);
  assert.equal(d.attach[0].linkConfidence, 'note_number_series');
  assert.equal(d.outcome, 'paid');
});

test('a bare number matching two document types is NEVER guessed', () => {
  const d = run(
    ['המסמך נוצר בהצלחה מספר 12345'],
    [ledgerDoc('invrec', '12345'), ledgerDoc('receipt', '12345')],
  );
  assert.equal(d.attach.length, 0);
  assert.equal(d.review.code, 'ambiguous_reference');
});

test('only billing paper → the deal stays unpaid, and the paper is still attached', () => {
  const d = run(['חשבון עסקה 54424'], [ledgerDoc('deal', '54424')]);
  assert.equal(d.attach.length, 1);
  assert.equal(d.projected.paidMinor, 0);
  assert.equal(d.outcome, 'unpaid_with_billing_documents');
  assert.equal(d.review, null);
});

test('an invoice alone does not prove payment', () => {
  const d = run(['חשבונית מס 10149'], [ledgerDoc('invoice', '10149')]);
  assert.equal(d.projected.paidMinor, 0);
  assert.equal(d.outcome, 'unpaid_with_billing_documents');
});

test('a partial receipt yields a partial outcome, not paid', () => {
  const d = run(['קבלה 20241'], [ledgerDoc('receipt', '20241', { totalMinor: 100_000n, paidMinor: 30_000n })]);
  assert.equal(d.projected.paidMinor, 30_000);
  assert.equal(d.outcome, 'partial');
});

test('a credit note subtracts, and an unbased credit is flagged', () => {
  const d = run(
    ['חשבונית מס קבלה 38474', 'חשבונית זיכוי 40001'],
    [ledgerDoc('invrec', '38474'), ledgerDoc('refund', '40001', { totalMinor: -40_000n })],
  );
  assert.equal(d.projected.paidMinor, 60_000);
  // The invrec IS a valid base for the credit, so the chain is resolved.
  assert.equal(d.review, null);
  assert.equal(d.outcome, 'partial');
});

test('a credit note with no base document on the deal goes to review', () => {
  const d = run(['חשבונית זיכוי 40001'], [ledgerDoc('refund', '40001', { totalMinor: -40_000n })]);
  assert.equal(d.review.code, 'credit_without_base');
});

test('a cancelled document is never attached and is called out', () => {
  const d = run(['חשבונית מס קבלה 38474'], [ledgerDoc('invrec', '38474', { isCancelled: true })]);
  assert.equal(d.attach.length, 0);
  assert.equal(d.projected.paidMinor, 0);
  assert.equal(d.review.code, 'cancelled_document');
});

test('a document claimed by several deals is attached to NONE of them', () => {
  // One consolidated invoice covering ten deals: attaching it to each would
  // count the same money ten times, and splitting it needs a human.
  const claims = new Map([['receipt:20241', ['deal-1', 'deal-2', 'deal-3']]]);
  const d = run(['קבלה 20241'], [ledgerDoc('receipt', '20241')], {}, claims);
  assert.equal(d.attach.length, 0);
  assert.equal(d.review.code, 'shared_document');
  assert.equal(d.review.details.problems[0].dealCount, 3);
});

test('a reference iCount does not recognise is reported, not invented', () => {
  const d = run(['חשבונית מס קבלה 99999'], []);
  assert.equal(d.attach.length, 0);
  assert.equal(d.review.code, 'unresolved_reference');
});

test('a number below the account\'s lowest document number is not a reference at all', () => {
  // "זיכוי 240" is a credit of ₪240, not document 240. Raising it as an
  // unresolved reference would be noise, and noise is what makes operators
  // stop reading flags. The threshold comes from the census, never hard-coded.
  const references = referencesForDeal([{ text: 'זיכוי 240', source: 'note' }]);
  const ledger = makeLedger([ledgerDoc('invrec', '38474')]);
  ledger.minDocnum = 10000;
  const d = decideDeal({ deal: deal(), references, ledger, claims: new Map() });
  assert.equal(d.attach.length, 0);
  assert.equal(d.review, null);
  assert.equal(d.skipped[0].reason, 'below_document_number_range');
});

test('a shared-document review names the other deals by order number', () => {
  const claims = new Map([['receipt:20241', ['deal-1', 'deal-2']]]);
  const claimInfo = new Map([
    ['deal-1', { orderNo: 26000, valueMinor: 100_000n }],
    ['deal-2', { orderNo: 26001, valueMinor: 250_000n }],
  ]);
  const references = referencesForDeal([{ text: 'קבלה 20241', source: 'note' }]);
  const d = decideDeal({
    deal: deal(),
    references,
    ledger: makeLedger([ledgerDoc('receipt', '20241')]),
    claims,
    claimInfo,
  });
  const p = d.review.details.problems[0];
  assert.equal(p.code, 'shared_document');
  assert.deepEqual(p.deals.map((x) => x.orderNo), [26000, 26001]);
  assert.equal(p.deals[1].valueMinor, 250_000);
});

test('a document issued to a different customer is attached BUT flagged', () => {
  // The number came from this deal's own record — strong evidence — so the
  // money is shown; the mismatch is what a human must confirm.
  const d = run(['חשבונית מס קבלה 38474'], [ledgerDoc('invrec', '38474', { clientName: 'חברה אחרת בע״מ' })]);
  assert.equal(d.attach.length, 1);
  assert.equal(d.review.code, 'customer_mismatch');
  assert.equal(d.outcome, 'review');
});

test('a foreign-currency document is flagged instead of being added in', () => {
  const d = run(['חשבונית מס קבלה 38474'], [ledgerDoc('invrec', '38474', { currency: 'USD' })]);
  assert.equal(d.review.code, 'currency_mismatch');
  assert.equal(d.projected.paidMinor, 0); // the USD document did not join the shekel total
});

test('a payment materially larger than the deal total is flagged', () => {
  const d = run(['חשבונית מס קבלה 38474'], [ledgerDoc('invrec', '38474', { totalMinor: 500_000n })]);
  assert.equal(d.review.code, 'amount_conflict');
});

test('a small overshoot is NOT flagged — rounding and extras are normal', () => {
  const d = run(['חשבונית מס קבלה 38474'], [ledgerDoc('invrec', '38474', { totalMinor: 105_000n })]);
  assert.equal(d.review, null);
});

test('an already-linked document is skipped — the run is idempotent', () => {
  const references = referencesForDeal([{ text: 'חשבונית מס קבלה 38474', source: 'note' }]);
  const docs = [ledgerDoc('invrec', '38474')];
  const args = {
    deal: deal(),
    references,
    ledger: makeLedger(docs),
    claims: new Map([['invrec:38474', ['deal-1']]]),
    alreadyLinked: new Set(['invrec:38474']),
  };
  const d = decideDeal(args);
  assert.equal(d.attach.length, 0);
  assert.equal(d.review, null);
});

test('the most severe problem becomes the headline, and every finding is kept', () => {
  const claims = new Map([['invrec:38474', ['deal-1', 'deal-2']]]);
  const d = run(
    ['חשבונית מס קבלה 38474', 'קבלה 99999'],
    [ledgerDoc('invrec', '38474')],
    {},
    claims,
  );
  assert.equal(d.review.code, 'shared_document'); // outranks unresolved_reference
  assert.equal(d.review.details.problems.length, 2);
});

// ── Customer verification ───────────────────────────────────────────────────

test('a shared tax id is decisive even when the names differ', () => {
  const identity = dealIdentityOf(deal({ organization: { name: 'שם אחר לגמרי', taxId: '511603649' } }));
  const m = customerMatches(ledgerDoc('invrec', '1', { clientVatId: '511603649' }), identity);
  assert.equal(m.match, true);
  assert.equal(m.basis, 'tax_id');
});

test('name comparison survives gershayim and spacing', () => {
  const identity = dealIdentityOf(deal({ organization: { name: 'גרפיטיול בע"מ', taxId: null } }));
  assert.equal(customerMatches(ledgerDoc('invrec', '1', { clientName: 'גרפיטיול בע״מ' }), identity).match, true);
});

test('a document with no customer name is not treated as a mismatch', () => {
  const identity = dealIdentityOf(deal());
  assert.equal(customerMatches(ledgerDoc('invrec', '1', { clientName: '' }), identity).match, true);
});

// ── The backfill's own history entry must sit in history ────────────────────

test('the reconstruction entry is dated to the newest document it describes', async () => {
  // emitTimelineEvent stamps Deal.lastMeaningfulActivityAt from the ENTRY's
  // timestamp, and the Deals list orders by that. An undated backfill entry
  // would rocket thousands of years-old deals to the top of the CRM — caught in
  // production on the first apply pass, and this is the guard.
  const { newestIssuedAt } = await import('./collectionBackfillRunner.js');
  const d = (iso) => ({ issuedAt: new Date(iso) });
  assert.equal(
    newestIssuedAt([d('2022-05-01'), d('2023-09-14'), d('2022-11-02')]).toISOString(),
    new Date('2023-09-14').toISOString(),
  );
  // No usable date → null, so the caller omits createdAt rather than inventing one.
  assert.equal(newestIssuedAt([{ issuedAt: null }]), null);
  assert.equal(newestIssuedAt([]), null);
});

test('a re-run reports the deal it already settled as paid, not as unpaid', () => {
  // The second run has nothing left to attach. If the outcome were computed from
  // this run's delta alone, every deal the first run settled would be reported
  // "unpaid" — making the summary useless exactly when it is needed most, for
  // verifying idempotency.
  const references = referencesForDeal([{ text: 'חשבונית מס קבלה 38474', source: 'note' }]);
  const d = decideDeal({
    deal: deal(),
    references,
    ledger: makeLedger([ledgerDoc('invrec', '38474')]),
    claims: new Map([['invrec:38474', ['deal-1']]]),
    alreadyLinked: new Set(['invrec:38474']),
    linkedDocs: [{ doctype: 'invrec', docnum: '38474', amountMinor: 100_000n, paidMinor: null, currency: 'ILS', status: 'issued' }],
  });
  assert.equal(d.attach.length, 0); // nothing new — idempotent
  assert.equal(d.projected.paidMinor, 100_000);
  assert.equal(d.outcome, 'paid');
});

test('a cancelled document already on the deal still contributes nothing', () => {
  const references = referencesForDeal([{ text: 'x', source: 'note' }]);
  const d = decideDeal({
    deal: deal(),
    references,
    ledger: makeLedger([]),
    claims: new Map(),
    linkedDocs: [{ doctype: 'invrec', docnum: '1', amountMinor: 100_000n, paidMinor: null, currency: 'ILS', status: 'cancelled' }],
  });
  assert.equal(d.projected.paidMinor, 0);
});

test('a credit chain completed by an already-attached invoice is not re-flagged', () => {
  const references = referencesForDeal([{ text: 'חשבונית זיכוי 40001', source: 'note' }]);
  const d = decideDeal({
    deal: deal(),
    references,
    ledger: makeLedger([ledgerDoc('refund', '40001', { totalMinor: -40_000n })]),
    claims: new Map([['refund:40001', ['deal-1']]]),
    linkedDocs: [{ doctype: 'invrec', docnum: '38474', amountMinor: 100_000n, paidMinor: null, currency: 'ILS', status: 'issued' }],
  });
  assert.equal(d.review, null);
  assert.equal(d.projected.paidMinor, 60_000);
});

test('a customer mismatch stays flagged on a re-run — it is a standing fact', () => {
  // Checking it only when the document is first attached let a second run
  // withdraw 167 legitimate flags in production. The mismatch is a property of
  // the document, not of the moment it was linked.
  const references = referencesForDeal([{ text: 'חשבונית מס קבלה 38474', source: 'note' }]);
  const args = {
    deal: deal(),
    references,
    ledger: makeLedger([ledgerDoc('invrec', '38474', { clientName: 'חברה אחרת בע״מ' })]),
    claims: new Map([['invrec:38474', ['deal-1']]]),
  };
  const first = decideDeal(args);
  assert.equal(first.review.code, 'customer_mismatch');
  assert.equal(first.attach.length, 1);

  const second = decideDeal({
    ...args,
    alreadyLinked: new Set(['invrec:38474']),
    linkedDocs: [{ doctype: 'invrec', docnum: '38474', amountMinor: 100_000n, paidMinor: null, currency: 'ILS', status: 'issued' }],
  });
  assert.equal(second.attach.length, 0);
  assert.equal(second.review.code, 'customer_mismatch'); // still flagged
});

test('a foreign-currency document already attached still forces review', () => {
  const references = referencesForDeal([{ text: 'x', source: 'note' }]);
  const d = decideDeal({
    deal: deal(),
    references,
    ledger: makeLedger([]),
    claims: new Map(),
    linkedDocs: [{ doctype: 'invrec', docnum: '1', amountMinor: 100_000n, paidMinor: null, currency: 'USD', status: 'issued' }],
  });
  assert.equal(d.review.code, 'currency_mismatch');
  assert.equal(d.projected.paidMinor, 0);
});
