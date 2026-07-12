import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The centralization guarantee: EVERY tour-mutating api call emits the ONE
// canonical `gos:tour-changed` signal exactly once on success, while reads and
// non-tour deal edits stay silent. api.js and this test share the same
// tourEvents.js module instance (ESM path cache), so onTourChanged here hears
// the emits api.js fires internally.

let api;
let onTourChanged;
let lastPath;

before(async () => {
  globalThis.BroadcastChannel = undefined; // avoid a real Node channel handle
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
  // Every request succeeds; capture the path so we know the call was made.
  globalThis.fetch = async (path) => {
    lastPath = path;
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  };
  ({ api } = await import('./api.js'));
  ({ onTourChanged } = await import('../admin/tours/tourEvents.js'));
});

let emits;
let off;
beforeEach(() => {
  emits = 0;
  off = onTourChanged(() => {
    emits += 1;
  });
});
afterEach(() => off && off());

// helper: run a call, return how many emits it produced
async function countEmits(fn) {
  emits = 0;
  await fn();
  return emits;
}

test('tour mutations emit exactly once', async () => {
  assert.equal(await countEmits(() => api.tours.update('t1', { status: 'cancelled' })), 1, 'update');
  assert.equal(await countEmits(() => api.tours.remove('t1')), 1, 'remove');
  assert.equal(await countEmits(() => api.tours.create({})), 1, 'create');
  assert.equal(await countEmits(() => api.tours.complete('t1')), 1, 'complete');
  assert.equal(await countEmits(() => api.tours.reopen('t1')), 1, 'reopen');
  assert.equal(await countEmits(() => api.tours.addAssignment('t1', {})), 1, 'addAssignment');
  assert.equal(await countEmits(() => api.tours.updateAssignment('a1', {})), 1, 'updateAssignment');
  assert.equal(await countEmits(() => api.tours.removeAssignment('a1')), 1, 'removeAssignment');
  assert.equal(await countEmits(() => api.tours.addComponent('t1', {})), 1, 'addComponent');
  assert.equal(await countEmits(() => api.tours.reorderComponents('t1', [])), 1, 'reorderComponents');
  assert.equal(await countEmits(() => api.tours.setComponentLocation('r1', 'w1')), 1, 'setComponentLocation');
  assert.equal(await countEmits(() => api.tours.removeComponent('r1')), 1, 'removeComponent');
  assert.equal(await countEmits(() => api.tours.reseedComponents('t1')), 1, 'reseedComponents');
  assert.equal(await countEmits(() => api.tours.assignDeal('d1', 't1')), 1, 'assignDeal (WON join)');
  assert.equal(await countEmits(() => api.tours.reconnectOrphan('b1')), 1, 'reconnectOrphan');
  assert.equal(await countEmits(() => api.tours.cancelOrphan('b1')), 1, 'cancelOrphan');
  assert.equal(await countEmits(() => api.tours.createScheduleRule({})), 1, 'createScheduleRule');
  assert.equal(await countEmits(() => api.tours.updateScheduleRule('s1', {})), 1, 'updateScheduleRule');
  assert.equal(await countEmits(() => api.tours.removeScheduleRule('s1')), 1, 'removeScheduleRule');
  assert.equal(await countEmits(() => api.tours.updateSchedulingSettings({})), 1, 'updateSchedulingSettings');
});

test('tour READS never emit', async () => {
  assert.equal(await countEmits(() => api.tours.list()), 0, 'list');
  assert.equal(await countEmits(() => api.tours.calendar({ from: '2026-07-01', to: '2026-07-31' })), 0, 'calendar');
  assert.equal(await countEmits(() => api.tours.get('t1')), 0, 'get');
  assert.equal(await countEmits(() => api.tours.completionState('t1')), 0, 'completionState');
  assert.equal(await countEmits(() => api.tours.orphans()), 0, 'orphans');
});

test('deal transitions that touch a tour emit; plain deal edits do not', async () => {
  assert.equal(await countEmits(() => api.deals.applyTourUpdate('d1')), 1, 'applyTourUpdate');
  assert.equal(await countEmits(() => api.deals.update('d1', { status: 'won', tourEventId: 't1' })), 1, 'WON');
  assert.equal(await countEmits(() => api.deals.update('d1', { status: 'lost', lostReasonId: 'r1' })), 1, 'LOST');
  assert.equal(await countEmits(() => api.deals.update('d1', { status: 'open', tourChoice: 'remove' })), 1, 'REOPEN');
  // Plain edits — a tour is NOT changed, so no emit (no needless refetch).
  assert.equal(await countEmits(() => api.deals.update('d1', { dealStageId: 's2' })), 0, 'stage move');
  assert.equal(await countEmits(() => api.deals.update('d1', { title: 'x' })), 0, 'field edit');
  assert.equal(await countEmits(() => api.deals.discardTourUpdate('d1')), 0, 'discard (no tour change)');
});

test('a failed mutation never emits', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({}), text: async () => 'nope' });
  let threw = false;
  const n = await countEmits(async () => {
    try {
      await api.tours.update('t1', { status: 'cancelled' });
    } catch {
      threw = true;
    }
  });
  globalThis.fetch = orig;
  assert.equal(threw, true, 'the rejection propagates');
  assert.equal(n, 0, 'no emit on failure');
});
