import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTourGuideColor } from '../../../shared/guideColor.mjs';

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
