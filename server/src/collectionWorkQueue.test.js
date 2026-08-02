import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeal, shouldWrite, COLLECTION_REVIEW_STATUS, SOURCE } from './collectionWorkQueue.js';

// The work queue answers "should anyone chase this money today?" — a BUSINESS
// question. It never re-derives payment state: `summary` comes from the
// canonical resolver and is read, not recomputed.

const TODAY = '2026-08-02';
const deal = (over = {}) => ({ tourDate: null, organizationId: null, activityType: null, ...over });
const sum = (status) => ({ status });
const go = (d, s, ctx = {}) => classifyDeal(d, s, { today: TODAY, ...ctx });

test('a fully paid deal is never work', () => {
  const r = go(deal({ organizationId: 'o1', tourDate: '2027-01-01' }), sum('paid'));
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.LEGACY);
  assert.equal(r.settled, true);
});

test('RULE B — a future tour that is not fully paid is active work', () => {
  assert.equal(go(deal({ tourDate: '2026-09-01' }), sum('partial')).status, COLLECTION_REVIEW_STATUS.ACTIVE);
  assert.equal(go(deal({ tourDate: '2026-09-01' }), sum('unpaid')).source, SOURCE.FUTURE_TOUR);
});

test('a PAST tour that is unpaid and private is legacy, not work', () => {
  const r = go(deal({ tourDate: '2022-05-01' }), sum('unpaid'));
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.LEGACY);
  assert.equal(r.source, SOURCE.LEGACY);
});

test('RULE A — an unpaid business deal is active work even in the past', () => {
  assert.equal(go(deal({ tourDate: '2022-05-01', organizationId: 'o1' }), sum('unpaid')).source, SOURCE.BUSINESS);
  assert.equal(go(deal({ tourDate: '2022-05-01', activityType: 'business' }), sum('partial')).source, SOURCE.BUSINESS);
});

test('the REAL Pipedrive filter, when available, outranks the GOS stand-in', () => {
  const r = go(deal({ tourDate: '2022-05-01' }), sum('unpaid'), { inBusinessCollectionSet: true });
  assert.equal(r.status, COLLECTION_REVIEW_STATUS.ACTIVE);
  assert.equal(r.source, SOURCE.PIPEDRIVE_FILTER); // the source records WHICH rule decided
});

test('a review-status deal still counts as unpaid work', () => {
  // 'review' is not 'paid', so it stays in the queue when it qualifies.
  assert.equal(go(deal({ organizationId: 'o1' }), sum('review')).status, COLLECTION_REVIEW_STATUS.ACTIVE);
});

test('an unpriced (no_amount) business deal is still work', () => {
  assert.equal(go(deal({ organizationId: 'o1' }), sum('no_amount')).status, COLLECTION_REVIEW_STATUS.ACTIVE);
});

// ── Write policy ────────────────────────────────────────────────────────────

test('a NULL classification is always populated', () => {
  assert.equal(shouldWrite(null, { status: 'active_collection', source: SOURCE.BUSINESS }), true);
  assert.equal(shouldWrite({ status: null }, { status: 'active_collection', source: SOURCE.BUSINESS }), true);
});

test('an OPERATOR decision is never overwritten — not even by a better-informed run', () => {
  const current = { status: 'likely_paid_legacy', source: SOURCE.OPERATOR };
  assert.equal(shouldWrite(current, { status: 'active_collection', source: SOURCE.PIPEDRIVE_FILTER }), false);
  assert.equal(shouldWrite(current, { status: 'active_collection', source: SOURCE.PIPEDRIVE_FILTER }, { allowMachineCorrection: true }), false);
});

test('a machine value is left alone by default, and corrected only when asked', () => {
  const current = { status: 'likely_paid_legacy', source: SOURCE.LEGACY };
  const next = { status: 'active_collection', source: SOURCE.PIPEDRIVE_FILTER };
  assert.equal(shouldWrite(current, next), false);
  assert.equal(shouldWrite(current, next, { allowMachineCorrection: true }), true);
});

test('a correction that changes nothing is not a write', () => {
  const current = { status: 'active_collection', source: SOURCE.BUSINESS };
  assert.equal(shouldWrite(current, { status: 'active_collection', source: SOURCE.BUSINESS }, { allowMachineCorrection: true }), false);
});
