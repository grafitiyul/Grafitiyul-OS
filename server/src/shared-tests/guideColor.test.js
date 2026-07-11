import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTourGuideColor,
  resolveTourGuideColorInfo,
} from '../../../shared/guideColor.mjs';

// The canonical tour guide-color rule — one resolver, one behavior on every
// surface. Spec cases pinned one by one.

test('one relevant guide → that guide’s color', () => {
  assert.equal(resolveTourGuideColor([{ role: 'guide', color: 'coral' }]), 'coral');
  assert.equal(resolveTourGuideColor([{ role: 'lead_guide', color: 'teal' }]), 'teal');
});

test('one lead + multiple guides → the lead’s color', () => {
  assert.equal(
    resolveTourGuideColor([
      { role: 'guide', color: 'blue' },
      { role: 'lead_guide', color: 'orange' },
      { role: 'guide', color: 'green' },
    ]),
    'orange',
  );
});

test('multiple guides without a lead → neutral (null)', () => {
  assert.equal(
    resolveTourGuideColor([
      { role: 'guide', color: 'blue' },
      { role: 'guide', color: 'green' },
    ]),
    null,
  );
});

test('workshop assistants never determine the color', () => {
  assert.equal(resolveTourGuideColor([{ role: 'workshop_assistant', color: 'pink' }]), null);
  assert.equal(
    resolveTourGuideColor([
      { role: 'workshop_assistant', color: 'pink' },
      { role: 'guide', color: 'lime' },
    ]),
    'lime',
  );
});

test('lead without a color → neutral, NEVER another guide’s color', () => {
  assert.equal(
    resolveTourGuideColor([
      { role: 'lead_guide', color: null },
      { role: 'guide', color: 'blue' },
    ]),
    null,
  );
  // single relevant guide without color → neutral too
  assert.equal(resolveTourGuideColor([{ role: 'guide', color: null }]), null);
});

test('no assignments / empty / malformed → neutral', () => {
  assert.equal(resolveTourGuideColor([]), null);
  assert.equal(resolveTourGuideColor(null), null);
  assert.equal(resolveTourGuideColor([null, { role: 'unknown', color: 'red' }]), null);
});

// ── semantic variant (calendar "unassigned = black" vs "neutral") ──────────
// SAME color rule, plus a source that distinguishes "no relevant guide at
// all" from "relevant guides exist but no single color wins".

test('info: no relevant guide at all → unassigned (empty / null / assistant-only)', () => {
  assert.deepEqual(resolveTourGuideColorInfo([]), { color: null, source: 'unassigned' });
  assert.deepEqual(resolveTourGuideColorInfo(null), { color: null, source: 'unassigned' });
  assert.deepEqual(resolveTourGuideColorInfo([{ role: 'workshop_assistant', color: 'pink' }]), {
    color: null,
    source: 'unassigned',
  });
});

test('info: a winning guide color → source guide', () => {
  assert.deepEqual(resolveTourGuideColorInfo([{ role: 'guide', color: 'coral' }]), {
    color: 'coral',
    source: 'guide',
  });
  assert.deepEqual(
    resolveTourGuideColorInfo([
      { role: 'guide', color: 'blue' },
      { role: 'lead_guide', color: 'orange' },
    ]),
    { color: 'orange', source: 'guide' },
  );
});

test('info: relevant guides without a winning color → neutral, NEVER unassigned', () => {
  // multiple guides, no lead
  assert.deepEqual(
    resolveTourGuideColorInfo([
      { role: 'guide', color: 'blue' },
      { role: 'guide', color: 'green' },
    ]),
    { color: null, source: 'neutral' },
  );
  // a single guide without a personal color
  assert.deepEqual(resolveTourGuideColorInfo([{ role: 'guide', color: null }]), {
    color: null,
    source: 'neutral',
  });
  // lead without a color among colored guides
  assert.deepEqual(
    resolveTourGuideColorInfo([
      { role: 'lead_guide', color: null },
      { role: 'guide', color: 'blue' },
    ]),
    { color: null, source: 'neutral' },
  );
});

test('info: the wrapper and the info variant can never disagree', () => {
  const cases = [
    [],
    null,
    [{ role: 'guide', color: 'teal' }],
    [{ role: 'guide', color: 'blue' }, { role: 'guide', color: 'green' }],
    [{ role: 'workshop_assistant', color: 'pink' }],
    [{ role: 'lead_guide', color: null }, { role: 'guide', color: 'blue' }],
  ];
  for (const c of cases) {
    assert.equal(resolveTourGuideColor(c), resolveTourGuideColorInfo(c).color);
  }
});
