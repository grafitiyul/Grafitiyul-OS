import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCollection, paymentRows, requiresCollection } from './collection.js';

// Collection (גבייה) math — "paid" counts ONLY money actually received:
// receipt (קבלה) + invrec (חשבונית מס קבלה), minus refund (חשבונית זיכוי).
// Billing paper and open payment links must never count.

const doc = (doctype, amountMinor, extra = {}) => ({
  id: `d-${doctype}-${amountMinor}`,
  doctype,
  amountMinor,
  currency: 'ILS',
  createdAt: '2026-07-01T10:00:00.000Z',
  ...extra,
});

test('paid: only receipt + invrec count', () => {
  const c = computeCollection(100_000, [
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
  const c = computeCollection(100_000, [doc('invrec', 100_000), doc('refund', 40_000)]);
  assert.equal(c.paidMinor, 60_000);
  assert.equal(c.balanceMinor, 40_000);
  assert.equal(c.status, 'partial');
});

test('no documents → unpaid, full balance', () => {
  const c = computeCollection(80_000, []);
  assert.equal(c.paidMinor, 0);
  assert.equal(c.balanceMinor, 80_000);
  assert.equal(c.paidPct, 0);
  assert.equal(c.status, 'unpaid');
  assert.equal(c.lastPaymentAt, null);
});

test('fully paid → status paid, balance 0', () => {
  const c = computeCollection(80_000, [doc('receipt', 80_000)]);
  assert.equal(c.status, 'paid');
  assert.equal(c.balanceMinor, 0);
  assert.equal(c.paidPct, 100);
});

test('deal with no priced amount → no_amount, pct null', () => {
  const c = computeCollection(0, []);
  assert.equal(c.status, 'no_amount');
  assert.equal(c.paidPct, null);
});

test('lastPaymentAt = newest receipt-type document; refunds do not set it', () => {
  const c = computeCollection(100_000, [
    doc('receipt', 10_000, { createdAt: '2026-06-01T00:00:00.000Z' }),
    doc('invrec', 10_000, { createdAt: '2026-07-05T00:00:00.000Z' }),
    doc('refund', 5_000, { createdAt: '2026-07-09T00:00:00.000Z' }),
  ]);
  assert.equal(c.lastPaymentAt, '2026-07-05T00:00:00.000Z');
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
  assert.equal(requiresCollection(computeCollection(100, [doc('receipt', 100)])), false);
  assert.equal(requiresCollection(computeCollection(100, [doc('receipt', 40)])), true);
  assert.equal(requiresCollection(computeCollection(100, [])), true);
  assert.equal(requiresCollection(computeCollection(0, [])), true); // WON but unpriced
});

test('BigInt amounts from Prisma are handled (Number coercion)', () => {
  const c = computeCollection(100_000n, [doc('receipt', 25_000n)]);
  assert.equal(c.paidMinor, 25_000);
  assert.equal(c.totalMinor, 100_000);
  assert.equal(c.paidPct, 25);
});
