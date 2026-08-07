import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getViewMode, setViewMode, resetViewModes, VIEW_MODE } from './workspaceViewMode.js';

// UI MODE follows the operator; DEAL DATA follows the deal.
//
// The record drawer remounts the whole workspace on Prev/Next (<DealDetail
// key={dealId}>), which is exactly why a mode has to live outside the
// component — and exactly why nothing deal-specific may live here.

// A minimal sessionStorage for node; the module must also survive not having one.
beforeEach(() => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
  };
  Object.keys(globalThis.sessionStorage); // no-op; keeps the shape honest
  resetViewModes();
});

test('a mode set on one deal is still set for the next one', () => {
  // The operator opens the WhatsApp panel on Deal A…
  setViewMode(VIEW_MODE.whatsappDock, true);
  // …presses Next, which remounts the workspace from scratch.
  assert.equal(getViewMode(VIEW_MODE.whatsappDock, false), true, 'Deal B opens with the panel open');
});

test('a mode the operator turned OFF stays off across navigation', () => {
  setViewMode(VIEW_MODE.whatsappDock, true);
  setViewMode(VIEW_MODE.whatsappDock, false);
  assert.equal(getViewMode(VIEW_MODE.whatsappDock, false), false);
});

test('an untouched mode falls back to its default', () => {
  assert.equal(getViewMode(VIEW_MODE.whatsappDock, false), false);
  assert.equal(getViewMode(VIEW_MODE.dealMobileTab, 'workspace'), 'workspace');
});

test('modes are keyed by the MODE, never by a record — nothing is deal-scoped', () => {
  // Every key in the registry names a piece of UI, not a record. A key that
  // embedded a deal id would mean deal state had leaked into this module.
  for (const key of Object.values(VIEW_MODE)) {
    assert.match(key, /^deal\.[a-zA-Z]+$/, `${key} names UI, not a record`);
  }
});

test('the mobile tab carries forward too', () => {
  setViewMode(VIEW_MODE.dealMobileTab, 'whatsapp');
  assert.equal(getViewMode(VIEW_MODE.dealMobileTab, 'workspace'), 'whatsapp');
});

test('modes still work with no storage at all (private mode / quota)', () => {
  delete globalThis.sessionStorage;
  resetViewModes();
  setViewMode(VIEW_MODE.whatsappDock, true);
  assert.equal(getViewMode(VIEW_MODE.whatsappDock, false), true, 'the in-memory mirror carries it');
});

test('the mode is scoped to the tab, not written to localStorage', () => {
  let touchedLocal = false;
  globalThis.localStorage = {
    getItem: () => { touchedLocal = true; return null; },
    setItem: () => { touchedLocal = true; },
    removeItem: () => { touchedLocal = true; },
  };
  setViewMode(VIEW_MODE.whatsappDock, true);
  getViewMode(VIEW_MODE.whatsappDock, false);
  assert.equal(touchedLocal, false, 'one click today must not redecorate every future session');
  delete globalThis.localStorage;
});
