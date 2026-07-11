import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEventVisual, isUnassignedScheduled, eventCity } from './eventVisuals.js';
import { staffColorHex } from '../../../../../shared/staffColors.mjs';

// Calendar event layering — full guide color for scheduled, black for
// unassigned, muted identity for completed, STATUS dominant for cancelled/
// postponed, canonical neutral for multi-guide-no-lead. Pure module; the
// classes/styles here are what MonthEvent and the time grid paint.

const ev = (over = {}) => ({ status: 'scheduled', guideColor: null, guideColorSource: 'neutral', ...over });

test('scheduled + guide color → FULL saturated background with auto foreground', () => {
  const yellow = calendarEventVisual(ev({ guideColor: 'yellow', guideColorSource: 'guide' }));
  assert.equal(yellow.style.backgroundColor, staffColorHex('yellow'));
  assert.equal(yellow.style.color, '#111827', 'bright yellow carries dark text');

  const navy = calendarEventVisual(ev({ guideColor: 'navy', guideColorSource: 'guide' }));
  assert.equal(navy.style.backgroundColor, staffColorHex('navy'));
  assert.equal(navy.style.color, '#FFFFFF', 'dark navy carries white text');
});

test('scheduled + unassigned → black event, white text', () => {
  const v = calendarEventVisual(ev({ guideColorSource: 'unassigned' }));
  assert.equal(v.style.backgroundColor, '#111827');
  assert.equal(v.style.color, '#FFFFFF');
  assert.ok(isUnassignedScheduled(ev({ guideColorSource: 'unassigned' })));
});

test('scheduled + neutral (multi-guide, no lead) → the canonical default style, NOT black', () => {
  const v = calendarEventVisual(ev({ guideColorSource: 'neutral' }));
  assert.equal(v.style, undefined, 'neutral keeps the class-based status style');
  assert.match(v.cls, /bg-blue-50/);
  assert.equal(isUnassignedScheduled(ev({ guideColorSource: 'neutral' })), false);
});

test('missing guideColorSource degrades safely (color → solid, no color → neutral, never black)', () => {
  const withColor = calendarEventVisual({ status: 'scheduled', guideColor: 'teal' });
  assert.equal(withColor.style.backgroundColor, staffColorHex('teal'));
  const without = calendarEventVisual({ status: 'scheduled' });
  assert.equal(without.style, undefined);
  assert.match(without.cls, /bg-blue-50/);
});

test('cancelled → red status style dominates ANY guide color', () => {
  const v = calendarEventVisual(ev({ status: 'cancelled', guideColor: 'green', guideColorSource: 'guide' }));
  assert.equal(v.style, undefined);
  assert.match(v.cls, /red/);
});

test('postponed → amber status style dominates (defensive — should never be dated)', () => {
  const v = calendarEventVisual(ev({ status: 'postponed', guideColor: 'purple', guideColorSource: 'guide' }));
  assert.equal(v.style, undefined);
  assert.match(v.cls, /amber/);
});

test('completed + guide color → muted identity (lighter than the raw hex), readable text', () => {
  const raw = staffColorHex('navy');
  const v = calendarEventVisual(ev({ status: 'completed', guideColor: 'navy', guideColorSource: 'guide' }));
  assert.notEqual(v.style.backgroundColor, raw, 'completed must not be the full saturated color');
  assert.match(v.style.backgroundColor, /^#[0-9A-F]{6}$/);
  assert.ok(['#111827', '#FFFFFF'].includes(v.style.color), 'foreground recomputed on the muted mix');
  // Unassigned-black never applies to completed "unassigned" markers either —
  // the muted treatment still runs through the same path.
  const done = calendarEventVisual(ev({ status: 'completed', guideColorSource: 'unassigned' }));
  assert.notEqual(done.style.backgroundColor, '#111827');
});

test('eventCity: shown only OUTSIDE the Home Location; missing flag fails open (city shows)', () => {
  assert.equal(eventCity({ city: 'חיפה', atHomeLocation: false }), 'חיפה');
  assert.equal(eventCity({ city: 'תל אביב', atHomeLocation: true }), null, 'home city is redundant');
  // No flag on the payload (or no home location configured) → SHOW the city.
  assert.equal(eventCity({ city: 'חיפה' }), 'חיפה');
  assert.equal(eventCity({ atHomeLocation: false }), null, 'no city → nothing to show');
  assert.equal(eventCity(null), null);
});
