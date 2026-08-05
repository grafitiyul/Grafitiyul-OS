import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEAL_ROW_TONE,
  DEAL_ROW_TONE_FALLBACK,
  EMPTY_STATE_TEXT,
  INITIAL_ROWS,
  dealRowTone,
  visibleDeals,
} from './contactDealsPanel.js';
import { DEAL_STATUS_LABELS, DEAL_STATUSES } from '../../deals/config.js';

// "דילים קודמים" panel rules: row tones per status, compact-set behavior,
// and the guarantee that status is never color-only.

test('row tones — OPEN light blue, WON soft green, LOST soft red', () => {
  assert.match(dealRowTone('open'), /bg-blue-50/);
  assert.match(dealRowTone('won'), /bg-emerald-50/);
  assert.match(dealRowTone('lost'), /bg-red-50/);
});

test('unknown status falls back to a neutral tone (never crashes)', () => {
  assert.equal(dealRowTone('archived'), DEAL_ROW_TONE_FALLBACK);
  assert.equal(dealRowTone(undefined), DEAL_ROW_TONE_FALLBACK);
});

test('every toned status also has a canonical TEXT label (not color-only)', () => {
  for (const status of Object.keys(DEAL_ROW_TONE)) {
    assert.ok(DEAL_STATUS_LABELS[status], `text label exists for ${status}`);
  }
  // And every canonical status has a tone.
  for (const status of DEAL_STATUSES) {
    assert.ok(DEAL_ROW_TONE[status], `row tone exists for ${status}`);
  }
});

test('visibleDeals — compact initial set, full list when expanded', () => {
  const deals = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}` }));
  assert.equal(visibleDeals(deals, false).length, INITIAL_ROWS);
  assert.equal(visibleDeals(deals, true).length, 9);
  // Small lists render whole without an expand affordance decision here.
  assert.equal(visibleDeals(deals.slice(0, 3), false).length, 3);
  // Server order preserved.
  assert.deepEqual(visibleDeals(deals, false).map((d) => d.id), ['d0', 'd1', 'd2', 'd3', 'd4']);
  assert.deepEqual(visibleDeals(null, false), []);
});

test('empty state wording', () => {
  assert.equal(EMPTY_STATE_TEXT, 'אין דילים קודמים לאיש קשר זה');
});
