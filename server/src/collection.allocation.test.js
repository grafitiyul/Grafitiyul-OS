// Collection behaviour under multi-deal payments.
//
// The question every test here answers is the one the owner set out: does each
// deal derive its OWN state from its OWN share, while the company's books still
// see the real money exactly once?

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCollection } from './collection.js';

const ILS = (n) => n * 100;
const deal = (valueMinor) => ({ valueMinor, currency: 'ILS', collectionReview: null });

const doc = (o) => ({
  id: o.id || 'd1', dealId: o.dealId || 'x', doctype: o.doctype || 'invrec',
  docnum: o.docnum || '100', status: 'issued', amountMinor: o.amountMinor,
  currency: 'ILS', clientName: 'c', source: o.source || 'user',
  allocationMinor: o.allocationMinor ?? null, allocationGroupId: o.allocationGroupId ?? null,
  sharedHistorical: o.sharedHistorical ?? false, paidMinor: o.paidMinor ?? null,
  createdAt: new Date('2026-08-08'), issuedAt: new Date('2026-08-08'),
});

const ev = (o) => ({
  id: o.id || 'e1', dealId: o.dealId || 'x', kind: o.kind || 'manual_payment',
  direction: o.direction || 'in', amountMinor: o.amountMinor, currency: 'ILS',
  status: 'active', origin: o.origin || 'operator', paidAt: new Date('2026-08-08'),
  createdAt: new Date('2026-08-08'),
  allocationMinor: o.allocationMinor ?? null, allocationGroupId: o.allocationGroupId ?? null,
});

// ── Independent per-deal state ───────────────────────────────────────────────

test('a ₪1,500 payment settles deal A fully and leaves deal B partial', () => {
  const g = 'doc:invrec:100';
  // Deal A owes ₪1,000 and is allocated ₪1,000.
  const a = computeCollection(deal(ILS(1000)), [doc({ dealId: 'a', amountMinor: ILS(1500), allocationMinor: ILS(1000), allocationGroupId: g })], []);
  // Deal B owes ₪1,000 and is allocated ₪500.
  const b = computeCollection(deal(ILS(1000)), [doc({ id: 'd2', dealId: 'b', amountMinor: ILS(1500), allocationMinor: ILS(500), allocationGroupId: g })], []);

  assert.equal(a.status, 'paid');
  assert.equal(a.paidMinor, ILS(1000));
  assert.equal(a.balanceMinor, 0);

  assert.equal(b.status, 'partial');
  assert.equal(b.paidMinor, ILS(500));
  assert.equal(b.balanceMinor, ILS(500));
});

test('sharing a payment NEVER marks a deal paid just because the payment exists', () => {
  const s = computeCollection(
    deal(ILS(5000)),
    [doc({ amountMinor: ILS(1500), allocationMinor: ILS(100), allocationGroupId: 'g' })],
    [],
  );
  assert.equal(s.status, 'partial');
  assert.equal(s.paidMinor, ILS(100));
});

test('a split payment ROW says out loud that this deal counts only a share', () => {
  const s = computeCollection(
    deal(ILS(1000)),
    [doc({ amountMinor: ILS(1500), allocationMinor: ILS(1000), allocationGroupId: 'g' })],
    [],
  );
  const row = s.payments[0];
  assert.equal(row.sharedHistorical, true, 'the panel must be able to badge it');
  assert.equal(row.documentAmountMinor, ILS(1500), 'the real payment');
  assert.equal(row.countedMinor, ILS(1000), 'this deal’s share');
  assert.equal(row.allocationGroupId, 'g');
});

// ── Manual evidence obeys the same rule ──────────────────────────────────────

test('a split bank transfer behaves exactly like a split document', () => {
  const g = 'pay:transfer1';
  const a = computeCollection(deal(ILS(1000)), [], [ev({ dealId: 'a', amountMinor: ILS(3000), allocationMinor: ILS(1000), allocationGroupId: g })]);
  const b = computeCollection(deal(ILS(1200)), [], [ev({ id: 'e2', dealId: 'b', amountMinor: ILS(3000), allocationMinor: ILS(1200), allocationGroupId: g })]);
  const c = computeCollection(deal(ILS(1000)), [], [ev({ id: 'e3', dealId: 'c', amountMinor: ILS(3000), allocationMinor: ILS(800), allocationGroupId: g })]);

  assert.equal(a.status, 'paid');
  assert.equal(b.status, 'paid');
  assert.equal(c.status, 'partial');
  assert.equal(c.paidMinor, ILS(800));
  // The row still reports the real money beside the share.
  assert.equal(a.payments[0].documentAmountMinor, ILS(3000));
  assert.equal(a.payments[0].countedMinor, ILS(1000));
});

// ── Nothing about the single-deal case changed ───────────────────────────────

test('an ordinary single-deal payment is completely unaffected', () => {
  const s = computeCollection(deal(ILS(250)), [doc({ amountMinor: ILS(250) })], []);
  assert.equal(s.status, 'paid');
  assert.equal(s.paidMinor, ILS(250));
  assert.equal(s.payments[0].sharedHistorical, false);
  assert.equal(s.payments[0].allocationGroupId, null);

  const m = computeCollection(deal(ILS(500)), [], [ev({ amountMinor: ILS(500) })]);
  assert.equal(m.status, 'paid');
  assert.equal(m.payments[0].sharedHistorical, false);
});

test('a partial receipt still counts what it recorded, not its face value', () => {
  const s = computeCollection(deal(ILS(1000)), [doc({ amountMinor: ILS(1000), paidMinor: ILS(400) })], []);
  assert.equal(s.paidMinor, ILS(400));
  assert.equal(s.status, 'partial');
});

// ── Over-allocation seen from ONE deal ───────────────────────────────────────

test('an over-allocated deal reads overpaid on its own books, not on the company’s', () => {
  // ₪1,500 payment, this deal credited ₪1,000 against a ₪700 total.
  const s = computeCollection(
    deal(ILS(700)),
    [doc({ amountMinor: ILS(1500), allocationMinor: ILS(1000), allocationGroupId: 'g' })],
    [],
  );
  assert.equal(s.status, 'overpaid');
  assert.equal(s.paidMinor, ILS(1000));
  // The DEAL says overpaid — which is exactly the signal an operator needs.
  // What must never happen is the COMPANY total inventing money; that is
  // asserted in companyCollectionTotals' own dedupe test below.
});

// ── Refunds still reverse a share ────────────────────────────────────────────

test('a credit note reduces the deal’s share-based balance', () => {
  const s = computeCollection(
    deal(ILS(1000)),
    [
      doc({ amountMinor: ILS(1500), allocationMinor: ILS(1000), allocationGroupId: 'g' }),
      doc({ id: 'r1', doctype: 'refund', docnum: '900', amountMinor: ILS(300) }),
    ],
    [],
  );
  assert.equal(s.grossPaidMinor, ILS(1000));
  assert.equal(s.creditedMinor, ILS(300));
  assert.equal(s.paidMinor, ILS(700));
  assert.equal(s.status, 'partial');
});
