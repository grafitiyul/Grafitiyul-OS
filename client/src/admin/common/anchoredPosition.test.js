import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAnchored, ANCHOR_MARGIN } from './anchoredPosition.js';

// The popover-clipping contract. Every case here is a real layout the Tours
// table produces: a cell at the far edge, a horizontally scrolled table, a
// trigger near the bottom, a note taller than the screen.

const VP = { width: 1440, height: 900 };
const rect = (over = {}) => ({ top: 400, bottom: 424, left: 600, right: 760, ...over });

const within = (p, width, vp = VP) =>
  p.left >= ANCHOR_MARGIN && p.left + width <= vp.width - ANCHOR_MARGIN;

test('default: opens below the anchor, aligned to the requested edge', () => {
  const p = placeAnchored({ anchor: rect(), viewport: VP, width: 300, height: 200, align: 'end' });
  assert.equal(p.top, 428, 'below the anchor + gap');
  assert.equal(p.left, 460, 'end-aligned: right edge lines up with the anchor');
  assert.equal(p.placement, 'below');
  assert.equal(p.flipped, false);
});

test('align=start lines the panel up with the anchor start edge', () => {
  const p = placeAnchored({ anchor: rect(), viewport: VP, width: 300, height: 200, align: 'start' });
  assert.equal(p.left, 600);
});

test('flips ABOVE when there is no room below', () => {
  const p = placeAnchored({
    anchor: rect({ top: 800, bottom: 824 }), viewport: VP, width: 300, height: 300, align: 'end',
  });
  assert.equal(p.placement, 'above');
  assert.equal(p.top, 496, '800 - 4 - 300');
  assert.ok(p.top >= ANCHOR_MARGIN);
});

test('a trigger near the LEFT edge flips horizontally instead of overflowing', () => {
  // Left-most visible column in an RTL table: end-alignment would put the
  // panel at a negative x. It must flip to start-alignment, not be clipped.
  const p = placeAnchored({
    anchor: rect({ left: 20, right: 120 }), viewport: VP, width: 420, align: 'end',
  });
  assert.equal(p.flipped, true);
  assert.equal(p.left, 20, 'flipped to the start edge');
  assert.ok(within(p, 420));
});

test('a trigger near the RIGHT edge flips the other way', () => {
  const p = placeAnchored({
    anchor: rect({ left: 1330, right: 1430 }), viewport: VP, width: 420, align: 'start',
  });
  assert.equal(p.flipped, true);
  assert.equal(p.left, 1010, 'flipped to the end edge (1430 - 420)');
  assert.ok(within(p, 420));
});

test('when NEITHER side fits, the panel is clamped fully inside the viewport', () => {
  const p = placeAnchored({
    anchor: rect({ left: 1380, right: 1440 }), viewport: { width: 500, height: 900 }, width: 420, align: 'end',
  });
  assert.equal(p.clamped, true);
  assert.ok(within(p, 420, { width: 500, height: 900 }), 'never off-screen');
});

test('a panel wider than the viewport still starts at the margin (never negative)', () => {
  const p = placeAnchored({
    anchor: rect(), viewport: { width: 320, height: 900 }, width: 420, align: 'end',
  });
  assert.equal(p.left, ANCHOR_MARGIN);
});

test('height is capped to the viewport so tall content scrolls internally', () => {
  const p = placeAnchored({ anchor: rect(), viewport: VP, width: 300, height: 2000, align: 'end' });
  assert.equal(p.maxHeight, 884, '900 - 2*8');
  assert.equal(p.placement, 'pinned');
  assert.ok(p.top >= ANCHOR_MARGIN, 'pinned inside the viewport, not above it');
});

test('horizontal table scroll moves the anchor — placement follows it, still inside', () => {
  // Same cell before/after the table scrolls: the anchor rect changes, the
  // panel tracks it and stays fully visible (this is what fixed positioning
  // + re-placement on scroll buys us).
  for (const left of [1200, 900, 40, -30]) {
    const p = placeAnchored({
      anchor: rect({ left, right: left + 160 }), viewport: VP, width: 420, align: 'end',
    });
    assert.ok(within(p, 420), `anchor at ${left} must stay on screen`);
  }
});

test('before the first measurement (height 0) it still returns a usable position', () => {
  const p = placeAnchored({ anchor: rect(), viewport: VP, width: 300, height: 0, align: 'end' });
  assert.equal(p.placement, 'below');
  assert.ok(Number.isFinite(p.top) && Number.isFinite(p.left));
});
