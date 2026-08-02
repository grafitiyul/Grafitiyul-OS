import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCollectionRows, UNKNOWN_STATUS } from './collectionSummary.js';

// The invariant this module exists to guarantee: every rendered row lands in
// exactly one bucket, so the cards can never sum to less than the table again.
// (Production case: 88 rows, cards summed 87 — a no_amount deal had no bucket.)

const row = (status, balanceMinor = 0) => ({ status, balanceMinor });
const sum = (s) => s.buckets.reduce((n, b) => n + b.count, 0);

test('Σ buckets === row count, for every canonical status at once', () => {
  const rows = [
    row('unpaid', 100), row('unpaid', 200), row('partial', 50),
    row('review', 0), row('no_amount', 0), row('overpaid', -30), row('paid', 0),
  ];
  const s = summarizeCollectionRows(rows);
  assert.equal(s.count, rows.length);
  assert.equal(sum(s), rows.length);
});

test('the production bug: a no_amount row is counted, not dropped', () => {
  // 84 unpaid + 2 partial + 1 review + 1 no_amount — the real 2026-08-02 queue.
  const rows = [
    ...Array.from({ length: 84 }, () => row('unpaid', 1000)),
    row('partial', 500), row('partial', 500),
    row('review', 0),
    row('no_amount', 0), // #24412 — previously in no card
  ];
  const s = summarizeCollectionRows(rows);
  assert.equal(s.count, 88);
  assert.equal(sum(s), 88);
  assert.deepEqual(s.buckets.find((b) => b.status === 'no_amount'), { status: 'no_amount', count: 1 });
});

test('a status the module has never heard of still gets a bucket', () => {
  // A NEW resolver status must change labels, never the arithmetic.
  const s = summarizeCollectionRows([row('unpaid'), row('some_future_status'), row(null)]);
  assert.equal(sum(s), 3);
  assert.ok(s.buckets.some((b) => b.status === 'some_future_status'));
  assert.ok(s.buckets.some((b) => b.status === UNKNOWN_STATUS));
});

test('buckets are mutually exclusive — one row, one bucket', () => {
  const s = summarizeCollectionRows([row('unpaid'), row('unpaid')]);
  assert.deepEqual(s.buckets, [{ status: 'unpaid', count: 2 }]);
});

test('balance sums only positive outstanding amounts', () => {
  // An overpaid deal's negative balance must not shrink the money still owed.
  const s = summarizeCollectionRows([row('unpaid', 10_000), row('overpaid', -2_000)]);
  assert.equal(s.balanceMinor, 10_000);
});

test('empty input → zero everywhere, no buckets', () => {
  const s = summarizeCollectionRows([]);
  assert.deepEqual(s, { count: 0, balanceMinor: 0, buckets: [] });
});
