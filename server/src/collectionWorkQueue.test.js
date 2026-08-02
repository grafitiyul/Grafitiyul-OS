import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeal, shouldWrite, COLLECTION_REVIEW_STATUS, SOURCE } from './collectionWorkQueue.js';
import { COLLECTION_SNAPSHOT_ORDER_NOS, COLLECTION_SNAPSHOT_EXPECTED } from './collectionSnapshot.js';

// The work queue answers "should anyone chase this money today?" — a BUSINESS
// question with exactly TWO answers-in: the hand-over snapshot, and a live
// future tour that is not fully paid. It never re-derives payment state, and it
// never invents a candidate of its own.

const sum = (status) => ({ status });

test('the snapshot is the queue: it stands whatever the payment state says', () => {
  for (const status of ['unpaid', 'partial', 'review', 'no_amount', 'paid']) {
    const r = classifyDeal(sum(status), { inCollectionSnapshot: true });
    assert.equal(r.status, COLLECTION_REVIEW_STATUS.ACTIVE);
    assert.equal(r.source, SOURCE.SNAPSHOT);
  }
});

test('a live future tour that is not fully paid is active work', () => {
  for (const status of ['unpaid', 'partial', 'review', 'no_amount', 'overpaid']) {
    const r = classifyDeal(sum(status), { hasLiveFutureTour: true });
    assert.equal(r.status, COLLECTION_REVIEW_STATUS.ACTIVE, status);
    assert.equal(r.source, SOURCE.FUTURE_TOUR);
  }
});

test('a live future tour that IS fully paid is not work', () => {
  assert.equal(classifyDeal(sum('paid'), { hasLiveFutureTour: true }).status, COLLECTION_REVIEW_STATUS.LEGACY);
});

// ── Payment review (deposit-vs-full audit) ──────────────────────────────────

test('a reviewed deposit-only deal with a future tour is work EVEN when it reads "paid"', () => {
  // The whole point of the review: the recorded agreed amount may itself be
  // the deposit, so the resolver's "paid" is not proof of full payment.
  for (const prs of ['confirmed_deposit', 'suspected_deposit']) {
    const r = classifyDeal(sum('paid'), { hasLiveFutureTour: true, paymentReviewStatus: prs });
    assert.equal(r.status, COLLECTION_REVIEW_STATUS.ACTIVE, prs);
    assert.equal(r.source, SOURCE.PAYMENT_REVIEW);
  }
});

test('a confirmed-full or unresolved review changes nothing', () => {
  for (const prs of ['confirmed_full', 'unresolved', null]) {
    assert.equal(
      classifyDeal(sum('paid'), { hasLiveFutureTour: true, paymentReviewStatus: prs }).status,
      COLLECTION_REVIEW_STATUS.LEGACY,
      String(prs),
    );
  }
});

test('a deposit review WITHOUT a live future tour does not invent a candidate', () => {
  // The queue's philosophy is preserved: the review classifies evidence; the
  // route into the queue still requires the money to be operationally chaseable
  // (a tour still ahead). Historical deposits stay a report, not work.
  const r = classifyDeal(sum('paid'), { paymentReviewStatus: 'confirmed_deposit' });
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.LEGACY);
});

test('THE WITHDRAWN HEURISTIC IS GONE — an unpaid business deal is not a candidate', () => {
  // GOS does not invent collection candidates. Without the snapshot or a live
  // future tour there is no route into the queue, whatever the deal looks like.
  const r = classifyDeal(sum('unpaid'), {});
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.LEGACY);
  assert.equal(r.source, SOURCE.LEGACY);
  // The old source no longer exists anywhere in the vocabulary.
  assert.equal(Object.values(SOURCE).includes('migration:business_unpaid'), false);
});

test('classifyDeal cannot infer a candidate from deal data it is not given', () => {
  // It receives a summary and two booleans — never a deal — so nothing inside
  // this module can quietly resurrect a heuristic by reading Deal.tourDate or
  // Deal.organizationId. Deal-shaped noise in the context is simply ignored.
  const noise = { tourDate: '2099-01-01', organizationId: 'org-1', activityType: 'business' };
  assert.equal(classifyDeal(sum('unpaid'), noise).status, COLLECTION_REVIEW_STATUS.LEGACY);
  assert.equal(classifyDeal(sum('unpaid'), { ...noise, hasLiveFutureTour: false }).status, COLLECTION_REVIEW_STATUS.LEGACY);
});

// ── Write policy ────────────────────────────────────────────────────────────

test('a NULL classification is populated', () => {
  assert.equal(shouldWrite(null, { status: 'active_collection', source: SOURCE.SNAPSHOT }), true);
});

test('an OPERATOR decision is never overwritten', () => {
  const current = { status: 'likely_paid_legacy', source: SOURCE.OPERATOR };
  assert.equal(shouldWrite(current, { status: 'active_collection', source: SOURCE.SNAPSHOT }), false);
});

test('a machine value IS replaced when the rules now disagree — this is the rollback', () => {
  const withdrawn = { status: 'active_collection', source: 'migration:business_unpaid' };
  const next = { status: 'likely_paid_legacy', source: SOURCE.LEGACY };
  assert.equal(shouldWrite(withdrawn, next), true);
});

test('an unchanged classification is not rewritten', () => {
  const current = { status: 'active_collection', source: SOURCE.SNAPSHOT };
  assert.equal(shouldWrite(current, { status: 'active_collection', source: SOURCE.SNAPSHOT }), false);
});

// ── The snapshot itself ─────────────────────────────────────────────────────

test('the snapshot holds exactly the handed-over deals, with no duplicates', () => {
  assert.equal(COLLECTION_SNAPSHOT_ORDER_NOS.length, COLLECTION_SNAPSHOT_EXPECTED);
  assert.equal(new Set(COLLECTION_SNAPSHOT_ORDER_NOS).size, COLLECTION_SNAPSHOT_EXPECTED);
  assert.ok(COLLECTION_SNAPSHOT_ORDER_NOS.every((n) => Number.isInteger(n) && n > 0));
});

test('the snapshot is frozen — it is a record of a decision, not a config knob', () => {
  assert.throws(() => COLLECTION_SNAPSHOT_ORDER_NOS.push(1));
});
