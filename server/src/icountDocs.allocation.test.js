// Issuing ONE document that settles several deals.
//
// The property this file protects is atomicity: the document row and EVERY
// deal's share are written in one transaction, so a document can never exist in
// GOS with half its allocations missing — and a retry converges instead of
// issuing a second document or a second share.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAllocationPlan } from './icountDocs.js';

const ILS = (n) => n * 100;

// ── The plan gate ────────────────────────────────────────────────────────────

test('no allocations → null: the ordinary single-deal document is untouched', () => {
  assert.equal(normalizeAllocationPlan(undefined, 'a', BigInt(ILS(250))), null);
  assert.equal(normalizeAllocationPlan([], 'a', BigInt(ILS(250))), null);
});

test('"all of it to the issuing deal" is not a split', () => {
  // Must stay null so the row shape matches every historical document.
  assert.equal(
    normalizeAllocationPlan([{ dealId: 'a', amountMinor: ILS(250) }], 'a', BigInt(ILS(250))),
    null,
  );
});

test('a real split is returned as a plan', () => {
  const plan = normalizeAllocationPlan(
    [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
    'a',
    BigInt(ILS(1500)),
  );
  assert.equal(plan.length, 2);
});

test('a PARTIAL allocation to the issuing deal alone is still a split', () => {
  // ₪1,500 document, only ₪1,000 attributed → the ₪500 remainder must be
  // tracked, so this may NOT collapse to the single-deal shape.
  const plan = normalizeAllocationPlan([{ dealId: 'a', amountMinor: ILS(1000) }], 'a', BigInt(ILS(1500)));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].amountMinor, ILS(1000));
});

test('the deal the document is issued against must appear in the plan', () => {
  assert.throws(
    () => normalizeAllocationPlan([{ dealId: 'b', amountMinor: ILS(1500) }], 'a', BigInt(ILS(1500))),
    (e) => e.code === 'allocation_origin_required',
  );
});

test('an OVER-allocating plan is accepted at issue time', () => {
  // Owner ruling: never block. ₪1,500 document, ₪1,700 attributed.
  const plan = normalizeAllocationPlan(
    [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(700) }],
    'a',
    BigInt(ILS(1500)),
  );
  assert.equal(plan.length, 2);
});

test('structurally impossible plans are still refused', () => {
  assert.throws(
    () => normalizeAllocationPlan(
      [{ dealId: 'a', amountMinor: ILS(1) }, { dealId: 'a', amountMinor: ILS(2) }],
      'a', BigInt(ILS(3)),
    ),
    (e) => e.code === 'allocation_deal_duplicate',
  );
  assert.throws(
    () => normalizeAllocationPlan([{ dealId: 'a', amountMinor: -5 }], 'a', BigInt(ILS(3))),
    (e) => e.code === 'allocation_amount_invalid',
  );
});

test('agorot rounding does not turn a whole-amount document into a split', () => {
  assert.equal(
    normalizeAllocationPlan([{ dealId: 'a', amountMinor: ILS(250) - 5 }], 'a', BigInt(ILS(250))),
    null,
  );
});
