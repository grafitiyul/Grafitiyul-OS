import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// The pure Israel-midnight scheduler behind useTourMidnightRefresh — arms a
// timer for the next IL midnight, emits + re-arms on fire, and recovers on tab
// visibility when the day rolled over. Injected clock/timers make it fully
// deterministic; no React, no real waiting.

let startMidnightRefresh;

before(async () => {
  // startMidnightRefresh itself uses no DOM, but the module also defines React
  // hooks — provide the globals its (unused-here) BroadcastChannel path checks.
  globalThis.BroadcastChannel = undefined;
  ({ startMidnightRefresh } = await import('./tourEvents.js'));
});

// A controllable fake timer + clock harness.
function harness(startDate) {
  let day = startDate;
  const scheduled = []; // { id, cb, ms }
  let nextId = 1;
  let emits = 0;
  const ctrl = startMidnightRefresh(() => (emits += 1), {
    // now() only feeds msUntilNextIsraelMidnight; the real formula is tested in
    // dates.test.js, so a fixed instant is fine here.
    now: () => new Date('2026-07-12T12:00:00Z'),
    today: () => day,
    setTimeoutFn: (cb, ms) => {
      const id = nextId++;
      scheduled.push({ id, cb, ms });
      return id;
    },
    clearTimeoutFn: (id) => {
      const i = scheduled.findIndex((t) => t.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
  });
  return {
    ctrl,
    emits: () => emits,
    pending: () => scheduled.length,
    lastMs: () => scheduled.at(-1)?.ms,
    // Fire the most recently armed timer (simulate reaching midnight).
    fireLatest: (rollTo) => {
      const t = scheduled.pop();
      if (rollTo) day = rollTo;
      t.cb();
    },
    setDay: (d) => (day = d),
  };
}

test('arms exactly one timer on start; none fired yet', () => {
  const h = harness('2026-07-12');
  assert.equal(h.pending(), 1, 'one timer armed for the next midnight');
  assert.equal(h.emits(), 0, 'nothing emitted on start');
  assert.ok(h.lastMs() > 0, 'a positive delay was scheduled');
  h.ctrl.stop();
});

test('firing the midnight timer emits once and re-arms the next midnight', () => {
  const h = harness('2026-07-12');
  h.fireLatest('2026-07-13'); // reach midnight → new day
  assert.equal(h.emits(), 1, 'emitted once at midnight');
  assert.equal(h.pending(), 1, 'the following midnight is armed');
  // And again the next night.
  h.fireLatest('2026-07-14');
  assert.equal(h.emits(), 2);
  h.ctrl.stop();
});

test('checkDayChange: same day → no emit; new day → emit + re-arm', () => {
  const h = harness('2026-07-12');
  h.ctrl.checkDayChange(); // still the same IL day (tab focus, no rollover)
  assert.equal(h.emits(), 0, 'focus without a date change never refreshes');

  h.setDay('2026-07-13'); // the day rolled over while the tab was hidden
  h.ctrl.checkDayChange();
  assert.equal(h.emits(), 1, 'a date change on visibility refreshes immediately');
  assert.equal(h.pending(), 1, 'the timer is realigned to the new day');
  h.ctrl.stop();
});

test('checkDayChange does not double-fire once the new day is recorded', () => {
  const h = harness('2026-07-12');
  h.setDay('2026-07-13');
  h.ctrl.checkDayChange();
  assert.equal(h.emits(), 1);
  h.ctrl.checkDayChange(); // same (already-recorded) day → nothing
  assert.equal(h.emits(), 1, 'no repeat emit for the same rolled-over day');
  h.ctrl.stop();
});

test('the midnight timer firing updates the baseline so a later focus is quiet', () => {
  const h = harness('2026-07-12');
  h.fireLatest('2026-07-13'); // midnight fired, baseline now 07-13
  assert.equal(h.emits(), 1);
  h.ctrl.checkDayChange(); // focus later the same new day → no extra emit
  assert.equal(h.emits(), 1, 'timer-fire and visibility-recovery never double-count');
  h.ctrl.stop();
});

test('stop clears the pending timer', () => {
  const h = harness('2026-07-12');
  assert.equal(h.pending(), 1);
  h.ctrl.stop();
  assert.equal(h.pending(), 0, 'no timer left armed after stop');
});
