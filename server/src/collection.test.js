import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCollection, paymentRows, requiresCollection } from './collection.js';

// Collection (גבייה) math — "paid" counts ONLY money actually received:
// receipt (קבלה) + invrec (חשבונית מס קבלה) + operator-attested manual payments,
// minus refund (חשבונית זיכוי) and manual credits. Billing paper and open
// payment links must never count.

const deal = (valueMinor, extra = {}) => ({ valueMinor, currency: 'ILS', ...extra });

const doc = (doctype, amountMinor, extra = {}) => ({
  id: `d-${doctype}-${amountMinor}`,
  doctype,
  amountMinor,
  currency: 'ILS',
  createdAt: '2026-07-01T10:00:00.000Z',
  ...extra,
});

const ev = (kind, amountMinor, extra = {}) => ({
  id: `e-${kind}-${amountMinor}`,
  kind,
  direction: kind === 'manual_credit' ? 'out' : 'in',
  amountMinor,
  currency: 'ILS',
  paidAt: '2026-07-02T10:00:00.000Z',
  createdAt: '2026-07-02T10:00:00.000Z',
  origin: 'operator',
  ...extra,
});

test('paid: only receipt + invrec count', () => {
  const c = computeCollection(deal(100_000), [
    doc('receipt', 30_000),
    doc('invrec', 20_000),
    doc('invoice', 100_000), // billing paper — not money
    doc('deal', 100_000), // חשבון עסקה — not money
  ]);
  assert.equal(c.paidMinor, 50_000);
  assert.equal(c.balanceMinor, 50_000);
  assert.equal(c.paidPct, 50);
  assert.equal(c.status, 'partial');
});

test('refund credit notes subtract from paid', () => {
  const c = computeCollection(deal(100_000), [doc('invrec', 100_000), doc('refund', 40_000)]);
  assert.equal(c.paidMinor, 60_000);
  assert.equal(c.creditedMinor, 40_000);
  assert.equal(c.balanceMinor, 40_000);
  assert.equal(c.status, 'partial');
});

test('a refund stored positive is still subtracted (sign lives in the doctype)', () => {
  // iCount reports credit notes negative; GOS stores the magnitude. A row that
  // slipped through negative must not silently ADD to paid.
  const c = computeCollection(deal(100_000), [doc('invrec', 100_000), doc('refund', -40_000)]);
  assert.equal(c.paidMinor, 60_000);
});

test('no documents → unpaid, full balance', () => {
  const c = computeCollection(deal(80_000), []);
  assert.equal(c.paidMinor, 0);
  assert.equal(c.balanceMinor, 80_000);
  assert.equal(c.paidPct, 0);
  assert.equal(c.status, 'unpaid');
  assert.equal(c.lastPaymentAt, null);
});

test('fully paid → status paid, balance 0', () => {
  const c = computeCollection(deal(80_000), [doc('receipt', 80_000)]);
  assert.equal(c.status, 'paid');
  assert.equal(c.balanceMinor, 0);
  assert.equal(c.paidPct, 100);
});

test('deal with no priced amount → no_amount, pct null', () => {
  const c = computeCollection(deal(0), []);
  assert.equal(c.status, 'no_amount');
  assert.equal(c.paidPct, null);
});

test('a partial receipt counts the money it recorded, not its face value', () => {
  // iCount `totalpaid` < gross: the customer paid a deposit against the doc.
  const c = computeCollection(deal(100_000), [doc('invrec', 100_000, { paidMinor: 30_000 })]);
  assert.equal(c.paidMinor, 30_000);
  assert.equal(c.status, 'partial');
});

test('overpaid is its own status, not silently clamped to paid', () => {
  const c = computeCollection(deal(80_000), [doc('receipt', 100_000)]);
  assert.equal(c.status, 'overpaid');
  assert.equal(c.balanceMinor, -20_000);
});

test('a few agorot of VAT rounding still reads as fully paid', () => {
  assert.equal(computeCollection(deal(100_000), [doc('receipt', 99_993)]).status, 'paid');
  // …but a real partial payment cannot hide inside the tolerance.
  assert.equal(computeCollection(deal(100_000), [doc('receipt', 99_000)]).status, 'partial');
});

test('cancelled documents never reach the math (excluded at the query level)', () => {
  // The loader filters status='issued'; the resolver is handed only live rows.
  // This test pins the contract that a cancelled row passed in by mistake is
  // still just data — the exclusion is the query's job, documented here.
  const c = computeCollection(deal(100_000), [doc('receipt', 100_000)]);
  assert.equal(c.status, 'paid');
});

test('lastPaymentAt uses the document ISSUE date, not the row write time', () => {
  // A historical document mirrored into GOS today was issued years ago.
  const c = computeCollection(deal(100_000), [
    doc('receipt', 10_000, { issuedAt: '2022-06-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' }),
    doc('invrec', 10_000, { issuedAt: '2022-07-05T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' }),
    doc('refund', 5_000, { issuedAt: '2022-07-09T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' }),
  ]);
  assert.equal(c.lastPaymentAt, '2022-07-05T00:00:00.000Z');
});

test('paymentRows: only money movements, refund marked out; paper excluded', () => {
  const rows = paymentRows([
    doc('receipt', 10_000),
    doc('refund', 5_000),
    doc('invoice', 90_000),
    doc('deal', 90_000),
  ]);
  assert.deepEqual(rows.map((r) => r.doctype), ['receipt', 'refund']);
  assert.equal(rows[0].direction, 'in');
  assert.equal(rows[1].direction, 'out');
  assert.equal(rows[0].doctypeLabel, 'קבלה');
});

test('requiresCollection: everything except fully paid needs attention', () => {
  assert.equal(requiresCollection(computeCollection(deal(100), [doc('receipt', 100)])), false);
  assert.equal(requiresCollection(computeCollection(deal(100), [doc('receipt', 40)])), true);
  assert.equal(requiresCollection(computeCollection(deal(100), [])), true);
  assert.equal(requiresCollection(computeCollection(deal(0), [])), true); // WON but unpriced
});

test('BigInt amounts from Prisma are handled (Number coercion)', () => {
  const c = computeCollection(deal(100_000n), [doc('receipt', 25_000n)]);
  assert.equal(c.paidMinor, 25_000);
  assert.equal(c.totalMinor, 100_000);
  assert.equal(c.paidPct, 25);
});

// ── Manual operator evidence ────────────────────────────────────────────────

test('manual payment counts as money and is marked manual, never as a document', () => {
  const c = computeCollection(deal(100_000), [], [ev('manual_payment', 40_000)]);
  assert.equal(c.paidMinor, 40_000);
  assert.equal(c.status, 'partial');
  const row = c.payments[0];
  assert.equal(row.evidenceClass, 'manual');
  assert.equal(row.rowType, 'evidence');
  assert.equal(row.doctype, undefined); // it is NOT an accounting document
});

test('a settlement brings the balance to zero through a real amount', () => {
  // The operator settles a deal that already received ₪300 of ₪1,000: the
  // settlement records the REMAINING ₪700, so the books show where it went.
  const c = computeCollection(deal(100_000), [doc('receipt', 30_000)], [ev('settlement', 70_000)]);
  assert.equal(c.paidMinor, 100_000);
  assert.equal(c.balanceMinor, 0);
  assert.equal(c.status, 'paid');
});

test('manual credit subtracts', () => {
  const c = computeCollection(deal(100_000), [doc('receipt', 100_000)], [ev('manual_credit', 25_000)]);
  assert.equal(c.paidMinor, 75_000);
  assert.equal(c.status, 'partial');
});

test('iCount evidence and manual evidence sum once each — no double counting', () => {
  const c = computeCollection(
    deal(100_000),
    [doc('invoice', 100_000), doc('receipt', 60_000)],
    [ev('manual_payment', 40_000)],
  );
  assert.equal(c.paidMinor, 100_000);
  assert.equal(c.status, 'paid');
  assert.equal(c.payments.length, 2); // the invoice is paper, not a payment
});

// ── Review ──────────────────────────────────────────────────────────────────

test('a flagged deal reports review and still returns its numbers', () => {
  const c = computeCollection(
    deal(100_000, { collectionReview: { code: 'shared_document', reason: 'מסמך משותף ל־10 עסקאות' } }),
    [doc('receipt', 100_000)],
  );
  assert.equal(c.status, 'review');
  assert.equal(c.review.code, 'shared_document');
  assert.equal(c.paidMinor, 100_000); // the numbers are not hidden
  assert.equal(requiresCollection(c), true);
});

test('a cleared review flag is inert', () => {
  const c = computeCollection(
    deal(100_000, { collectionReview: { code: 'shared_document', reason: 'x', clearedAt: '2026-08-01T00:00:00.000Z' } }),
    [doc('receipt', 100_000)],
  );
  assert.equal(c.status, 'paid');
  assert.equal(c.review, null);
});

test('a foreign-currency payment forces review and is never added in', () => {
  const c = computeCollection(deal(100_000), [
    doc('receipt', 50_000),
    doc('receipt', 50_000, { id: 'usd', currency: 'USD' }),
  ]);
  assert.equal(c.status, 'review');
  assert.deepEqual(c.foreignCurrencies, ['USD']);
  assert.equal(c.paidMinor, 50_000); // the USD receipt did NOT add to the shekel total
  assert.equal(c.review.code, 'currency_mismatch');
});

// ── Shared historical documents (owner ruling, 2026-08-01) ──────────────────

test('a shared historical document settles the deal by its OWN payable total', () => {
  // A ₪30,745 consolidated receipt covering twenty tours. On THIS deal it must
  // settle THIS deal — not report ₪30,745 received against a ₪1,638 order.
  const c = computeCollection(deal(163_800), [
    doc('receipt', 3_074_500, { sharedHistorical: true, allocationMinor: 163_800 }),
  ]);
  assert.equal(c.paidMinor, 163_800);
  assert.equal(c.balanceMinor, 0);
  assert.equal(c.status, 'paid');
  assert.equal(c.payments[0].sharedHistorical, true);
  // The document's real face value stays visible — the operator is entitled to
  // see that the settling document is much larger than this deal.
  assert.equal(c.payments[0].documentAmountMinor, 3_074_500);
});

test('allocation wins over the document total AND over totalpaid', () => {
  const c = computeCollection(deal(100_000), [
    doc('invrec', 900_000, { paidMinor: 900_000, sharedHistorical: true, allocationMinor: 100_000 }),
  ]);
  assert.equal(c.paidMinor, 100_000);
  assert.equal(c.status, 'paid');
});

test('a non-shared document is unaffected by the allocation field', () => {
  const c = computeCollection(deal(100_000), [doc('receipt', 100_000)]);
  assert.equal(c.paidMinor, 100_000);
  assert.equal(c.payments[0].sharedHistorical, false);
});

// ── Company totals: the aggregate invariant ─────────────────────────────────
// A shared historical document settles several deals. Per deal it contributes
// that deal's own total; company-wide it must contribute its OWN amount exactly
// once. Getting this wrong turns one consolidated receipt into fictional revenue.

import { companyCollectionTotals } from './collection.js';

function fakeDb({ documents = [], evidence = [], deals = [] }) {
  return {
    icountDocument: { findMany: async () => documents },
    dealCollectionEvidence: { findMany: async () => evidence },
    deal: { findMany: async () => deals },
  };
}

test('one shared document linked to three deals is counted ONCE company-wide', async () => {
  // ₪3,000 receipt settling three ₪1,000 deals.
  const shared = (dealId) => ({
    dealId, doctype: 'receipt', docnum: '20241',
    amountMinor: 300_000n, paidMinor: 300_000n,
    sharedHistorical: true, allocationMinor: 100_000n,
  });
  const t = await companyCollectionTotals(
    fakeDb({
      documents: [shared('a'), shared('b'), shared('c')],
      deals: [{ valueMinor: 100_000n }, { valueMinor: 100_000n }, { valueMinor: 100_000n }],
    }),
  );
  assert.equal(t.uniqueDocuments, 1);
  assert.equal(t.documentsReceivedMinor, 300_000); // the document's own amount, once
  assert.equal(t.collectedMinor, 300_000);
  assert.equal(t.wonValueMinor, 300_000);
  assert.equal(t.outstandingMinor, 0);
  assert.equal(t.sharedDocuments.documents, 1);
  assert.equal(t.sharedDocuments.dealLinks, 3);
});

test('per-deal and company-wide answers legitimately differ for a shared document', async () => {
  // Each deal reads as settled…
  const perDeal = computeCollection(deal(100_000), [
    doc('receipt', 300_000, { sharedHistorical: true, allocationMinor: 100_000 }),
  ]);
  assert.equal(perDeal.status, 'paid');
  assert.equal(perDeal.paidMinor, 100_000);
  // …while the company counts the document once, not once per deal.
  const t = await companyCollectionTotals(
    fakeDb({
      documents: ['a', 'b', 'c'].map((dealId) => ({
        dealId, doctype: 'receipt', docnum: '20241', amountMinor: 300_000n,
        paidMinor: 300_000n, sharedHistorical: true, allocationMinor: 100_000n,
      })),
      deals: [{ valueMinor: 100_000n }, { valueMinor: 100_000n }, { valueMinor: 100_000n }],
    }),
  );
  assert.equal(t.documentsReceivedMinor, 300_000);
  assert.notEqual(t.documentsReceivedMinor, 900_000); // what naive summation would say
});

test('ordinary documents on different deals are each counted', async () => {
  const t = await companyCollectionTotals(
    fakeDb({
      documents: [
        { dealId: 'a', doctype: 'invrec', docnum: '1', amountMinor: 100_000n, paidMinor: null, sharedHistorical: false, allocationMinor: null },
        { dealId: 'b', doctype: 'invrec', docnum: '2', amountMinor: 250_000n, paidMinor: null, sharedHistorical: false, allocationMinor: null },
      ],
      deals: [{ valueMinor: 100_000n }, { valueMinor: 250_000n }],
    }),
  );
  assert.equal(t.uniqueDocuments, 2);
  assert.equal(t.documentsReceivedMinor, 350_000);
  assert.equal(t.outstandingMinor, 0);
});

test('refunds subtract and manual money is reported on its own line', async () => {
  const t = await companyCollectionTotals(
    fakeDb({
      documents: [
        { dealId: 'a', doctype: 'invrec', docnum: '1', amountMinor: 100_000n, paidMinor: null, sharedHistorical: false, allocationMinor: null },
        { dealId: 'a', doctype: 'refund', docnum: '9', amountMinor: 20_000n, paidMinor: null, sharedHistorical: false, allocationMinor: null },
      ],
      evidence: [{ direction: 'in', amountMinor: 5_000n }],
      deals: [{ valueMinor: 100_000n }],
    }),
  );
  assert.equal(t.documentsReceivedMinor, 100_000);
  assert.equal(t.documentsRefundedMinor, 20_000);
  assert.equal(t.manualReceivedMinor, 5_000);
  assert.equal(t.collectedMinor, 85_000);
});
