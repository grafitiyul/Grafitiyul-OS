import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The canonical tour-changed signal — same-tab window CustomEvent delivery,
// payload passthrough, and clean unsubscribe. A tiny EventTarget-backed fake
// window (no JSDOM, no timers → the process exits cleanly) is all this needs;
// BroadcastChannel is intentionally absent so the module's degrade-to-null
// path is exercised.

let emitTourChanged;
let onTourChanged;
let TOUR_CHANGED_EVENT;

before(async () => {
  // Node exposes BroadcastChannel globally; force the degrade-to-null path so
  // this unit test exercises the pure same-tab window delivery deterministically
  // (and never opens a real channel handle).
  globalThis.BroadcastChannel = undefined;
  const target = new EventTarget();
  globalThis.window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, opts = {}) {
        super(type, opts);
        this.detail = opts.detail;
      }
    };
  }
  ({ emitTourChanged, onTourChanged, TOUR_CHANGED_EVENT } = await import('./tourEvents.js'));
});

let received;
beforeEach(() => {
  received = [];
});

test('event name is the documented canonical string', () => {
  assert.equal(TOUR_CHANGED_EVENT, 'gos:tour-changed');
});

test('emit delivers the detail to a same-tab subscriber', () => {
  const off = onTourChanged((d) => received.push(d));
  emitTourChanged({ tourEventId: 't1', dealId: 'd1' });
  assert.deepEqual(received, [{ tourEventId: 't1', dealId: 'd1' }]);
  off();
});

test('emit with no argument delivers an empty detail object', () => {
  const off = onTourChanged((d) => received.push(d));
  emitTourChanged();
  assert.deepEqual(received, [{}]);
  off();
});

test('unsubscribe stops further delivery', () => {
  const off = onTourChanged((d) => received.push(d));
  emitTourChanged({ tourEventId: 't1' });
  off();
  emitTourChanged({ tourEventId: 't2' });
  assert.equal(received.length, 1, 'only the pre-unsubscribe emit was received');
});

test('multiple subscribers all receive the same signal', () => {
  const a = [];
  const b = [];
  const offA = onTourChanged((d) => a.push(d));
  const offB = onTourChanged((d) => b.push(d));
  emitTourChanged({ tourEventId: 't9' });
  assert.deepEqual(a, [{ tourEventId: 't9' }]);
  assert.deepEqual(b, [{ tourEventId: 't9' }]);
  offA();
  offB();
});
