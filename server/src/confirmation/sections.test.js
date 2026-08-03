// Confirmation Email — section layout normalization tests. Pure: no DB.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_SECTION_KEYS,
  defaultSections,
  normalizeSections,
  blockIdsInSections,
} from './sections.js';

test('defaultSections: every auto section, visible, canonical order', () => {
  const d = defaultSections();
  assert.deepEqual(d.map((s) => s.key), AUTO_SECTION_KEYS);
  assert.ok(d.every((s) => s.kind === 'auto' && s.hidden === false));
});

test('normalize keeps saved order and hidden flags', () => {
  const saved = defaultSections().reverse();
  saved[0].hidden = true; // closing
  const out = normalizeSections(saved, []);
  assert.deepEqual(out.map((s) => s.key), [...AUTO_SECTION_KEYS].reverse());
  assert.equal(out[0].hidden, true);
});

test('unknown autos, duplicates and malformed entries are dropped', () => {
  const out = normalizeSections(
    [
      { kind: 'auto', key: 'greeting' },
      { kind: 'auto', key: 'greeting' },
      { kind: 'auto', key: 'mystery' },
      null,
      'x',
      { kind: 'block' },
    ],
    [],
  );
  assert.equal(out.filter((s) => s.key === 'greeting').length, 1);
  assert.equal(out.some((s) => s.key === 'mystery'), false);
  // all auto keys re-inserted → full layout
  assert.deepEqual([...out.map((s) => s.key)].sort(), [...AUTO_SECTION_KEYS].sort());
});

test('block refs survive only when valid; unknown ids dropped', () => {
  const saved = [
    { kind: 'auto', key: 'greeting' },
    { kind: 'block', sharedContentId: 'sc_ok', hidden: false },
    { kind: 'block', sharedContentId: 'sc_deleted', hidden: false },
    { kind: 'block', sharedContentId: 'sc_ok', hidden: false }, // dup
  ];
  const out = normalizeSections(saved, ['sc_ok']);
  const blocks = out.filter((s) => s.kind === 'block');
  assert.deepEqual(blocks, [{ kind: 'block', sharedContentId: 'sc_ok', hidden: false }]);
});

test('a missing auto key is re-inserted after its canonical predecessor', () => {
  const saved = defaultSections().filter((s) => s.key !== 'meeting_point');
  // put a block between tour_details and meeting_point_image to prove position
  saved.splice(2, 0, { kind: 'block', sharedContentId: 'sc_1', hidden: false });
  const out = normalizeSections(saved, ['sc_1']);
  const keys = out.map((s) => (s.kind === 'auto' ? s.key : `block:${s.sharedContentId}`));
  // meeting_point returns immediately after tour_details (its canonical predecessor)
  assert.equal(keys[keys.indexOf('tour_details') + 1], 'meeting_point');
  assert.ok(keys.includes('block:sc_1'));
});

test('blockIdsInSections extracts referenced ids only', () => {
  assert.deepEqual(
    blockIdsInSections([
      { kind: 'auto', key: 'greeting' },
      { kind: 'block', sharedContentId: 'a' },
      { kind: 'block', sharedContentId: 'b' },
    ]),
    ['a', 'b'],
  );
  assert.deepEqual(blockIdsInSections(null), []);
});
