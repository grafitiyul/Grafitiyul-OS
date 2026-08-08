import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileAllocations,
  proposeAllocations,
  countedMinorFor,
  isMultiDeal,
  ALLOCATION_TOLERANCE_MINOR,
} from './paymentAllocation.mjs';

const A = (dealId, amountMinor) => ({ dealId, amountMinor });

// ── The single-deal case must be untouched ───────────────────────────────────

test('one payment → one deal: balanced, nothing left over', () => {
  const r = reconcileAllocations(150000, [A('d1', 150000)]);
  assert.equal(r.state, 'balanced');
  assert.equal(r.realMinor, 150000);
  assert.equal(r.allocatedMinor, 150000);
  assert.equal(r.unallocatedMinor, 0);
  assert.equal(r.overAllocatedMinor, 0);
  assert.equal(r.dealCount, 1);
});

test('an un-allocated row counts the payment itself', () => {
  assert.equal(countedMinorFor({ amountMinor: 25000 }), 25000);
  assert.equal(countedMinorFor({ amountMinor: 25000, allocationMinor: null }), 25000);
  // A partial receipt still counts what it actually recorded as received.
  assert.equal(countedMinorFor({ amountMinor: 25000, paidMinor: 10000 }), 10000);
});

test('an allocated row counts ONLY its share, whatever the payment was', () => {
  assert.equal(countedMinorFor({ amountMinor: 300000, allocationMinor: 100000 }), 100000);
  // Allocation beats paidMinor — it is the more specific statement.
  assert.equal(countedMinorFor({ amountMinor: 300000, paidMinor: 300000, allocationMinor: 80000 }), 80000);
  // Zero is a real allocation, not "unset".
  assert.equal(countedMinorFor({ amountMinor: 300000, allocationMinor: 0 }), 0);
});

// ── N deals ──────────────────────────────────────────────────────────────────

test('one payment → two deals, both full', () => {
  const r = reconcileAllocations(150000, [A('a', 100000), A('b', 50000)]);
  assert.equal(r.state, 'balanced');
  assert.equal(r.dealCount, 2);
});

test('one payment → three deals with a remainder', () => {
  // The owner's worked example: ₪3,000 over ₪1,000 + ₪1,200 + ₪500.
  const r = reconcileAllocations(300000, [A('a', 100000), A('b', 120000), A('c', 50000)]);
  assert.equal(r.state, 'unallocated');
  assert.equal(r.allocatedMinor, 270000);
  assert.equal(r.unallocatedMinor, 30000);
  assert.equal(r.overAllocatedMinor, 0);
});

test('one payment → four deals, all partial, exactly balanced', () => {
  const r = reconcileAllocations(400000, [A('a', 100000), A('b', 100000), A('c', 100000), A('d', 100000)]);
  assert.equal(r.state, 'balanced');
  assert.equal(r.dealCount, 4);
});

test('nothing about the math knows the number two', () => {
  const many = Array.from({ length: 25 }, (_, i) => A(`d${i}`, 1000));
  const r = reconcileAllocations(25000, many);
  assert.equal(r.state, 'balanced');
  assert.equal(r.dealCount, 25);
});

// ── Over-allocation is ALLOWED and always visible ────────────────────────────

test('over-allocation is reported, never absorbed and never a payment', () => {
  // The owner's worked example: ₪1,500 real, ₪1,700 allocated.
  const r = reconcileAllocations(150000, [A('a', 100000), A('b', 70000)]);
  assert.equal(r.state, 'over');
  assert.equal(r.overAllocatedMinor, 20000);
  assert.equal(r.unallocatedMinor, 0);
  // THE invariant: the real money is untouched by how it was carved up.
  assert.equal(r.realMinor, 150000);
});

test('over and under are mutually exclusive magnitudes, never signed', () => {
  const over = reconcileAllocations(1000, [A('a', 1500)]);
  const under = reconcileAllocations(1000, [A('a', 500)]);
  assert.ok(over.overAllocatedMinor > 0 && over.unallocatedMinor === 0);
  assert.ok(under.unallocatedMinor > 0 && under.overAllocatedMinor === 0);
});

// ── Tolerance ────────────────────────────────────────────────────────────────

test('agorot-level rounding does not raise a discrepancy', () => {
  assert.equal(reconcileAllocations(100000, [A('a', 100000 - ALLOCATION_TOLERANCE_MINOR)]).state, 'balanced');
  assert.equal(reconcileAllocations(100000, [A('a', 100000 + ALLOCATION_TOLERANCE_MINOR)]).state, 'balanced');
  assert.equal(reconcileAllocations(100000, [A('a', 100000 - ALLOCATION_TOLERANCE_MINOR - 1)]).state, 'unallocated');
  assert.equal(reconcileAllocations(100000, [A('a', 100000 + ALLOCATION_TOLERANCE_MINOR + 1)]).state, 'over');
});

test('no allocations at all is "empty", not "unallocated"', () => {
  assert.equal(reconcileAllocations(100000, []).state, 'empty');
});

// ── The opening proposal ─────────────────────────────────────────────────────

test('the proposal pays each deal what it owes, in order, until the money runs out', () => {
  const plan = proposeAllocations(300000, [
    { dealId: 'a', remainingMinor: 100000 },
    { dealId: 'b', remainingMinor: 120000 },
    { dealId: 'c', remainingMinor: 500000 },
  ]);
  assert.deepEqual(plan, [A('a', 100000), A('b', 120000), A('c', 80000)]);
  assert.equal(reconcileAllocations(300000, plan).state, 'balanced');
});

test('the proposal NEVER over-allocates on its own', () => {
  const plan = proposeAllocations(50000, [
    { dealId: 'a', remainingMinor: 100000 },
    { dealId: 'b', remainingMinor: 100000 },
  ]);
  assert.deepEqual(plan, [A('a', 50000), A('b', 0)]);
  assert.ok(reconcileAllocations(50000, plan).overAllocatedMinor === 0);
});

test('a fully-paid deal in the list is proposed nothing, not a negative', () => {
  const plan = proposeAllocations(100000, [
    { dealId: 'paid', remainingMinor: -5000 },
    { dealId: 'owing', remainingMinor: 100000 },
  ]);
  assert.deepEqual(plan, [A('paid', 0), A('owing', 100000)]);
});

test('isMultiDeal', () => {
  assert.equal(isMultiDeal([A('a', 1)]), false);
  assert.equal(isMultiDeal([A('a', 1), A('b', 1)]), true);
  assert.equal(isMultiDeal([]), false);
});
