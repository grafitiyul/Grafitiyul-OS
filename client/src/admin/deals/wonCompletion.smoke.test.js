import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// WON completion form — RENDERS the real WonCompletionDialog (esbuild bundle,
// jsdom) against a recording fetch stub and proves the contract:
//
//   1. the checklist comes from the SERVER (one won-readiness call per change);
//   2. filling a field re-asks and the requirement set updates LIVE;
//   3. "השלם והפוך ל-WON" is ONE canonical PUT carrying the completed fields
//      AND status:'won' — no separate save, no second WON click;
//   4. only CHANGED fields travel (a narrow patch — unrelated deal state and
//      other operators' newer values are never overwritten);
//   5. the primary button is disabled until the server says ready, and a
//      double-click cannot produce two PUTs;
//   6. a 422 after save keeps the dialog open with the FRESH server list, and
//      does NOT report success;
//   7. tour_slot_required hands the filled fields to the slot picker instead of
//      guessing a slot.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'won-completion-smoke');

const DEAL = {
  id: 'd1',
  orderNo: 27100,
  status: 'open',
  activityType: 'private',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
  tourDate: '2026-09-01',
  tourTime: null,
  participants: 12,
  tourLanguage: 'he',
  organizationId: null,
};

let calls = [];
// The scripted answers to POST /won-readiness, in order. A function receives
// the request body so a test can react to the draft.
let readinessFn = null;
let putResult = null; // null = ok; { status, body } = throw that payload

let React;
let createRoot;
let act;
let WonCompletionDialog;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method, body });
    if (u.includes('/won-readiness')) {
      return json(readinessFn ? readinessFn(body) : { missing: [], needsSlot: false, ready: true });
    }
    if (method === 'PUT' && /\/api\/deals\/d1$/.test(u)) {
      if (putResult) {
        return {
          ok: false,
          status: putResult.status,
          json: async () => putResult.body,
          text: async () => JSON.stringify(putResult.body),
        };
      }
      return json({ ...DEAL, status: 'won' });
    }
    if (u.includes('/api/locations')) return json([{ id: 'l1', nameHe: 'תל אביב' }, { id: 'l2', nameHe: 'חיפה' }]);
    if (u.includes('/api/activity-types')) return json([{ id: 'at1', key: 'private' }]);
    if (u.includes('/api/products/')) return json({ id: 'p1', variants: [{ id: 'v1', location: { id: 'l1', nameHe: 'תל אביב' } }] });
    return json({});
  };
  const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'wonCompletion.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'WonCompletionDialog.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  WonCompletionDialog = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  calls = [];
  readinessFn = null;
  putResult = null;
  // The Dialog renders through a PORTAL on <body>, so a leftover panel from a
  // previous test would be found by the queries below and clicked instead of
  // the live one. Each test starts on a clean document.
  document.body.innerHTML = '';
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const puts = () => calls.filter((c) => c.method === 'PUT');
const probes = () => calls.filter((c) => c.url.includes('/won-readiness'));
const text = () => document.body.textContent;
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

async function render(props = {}) {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  const state = { won: 0, needSlot: null, closed: 0 };
  await act(async () => root.render(React.createElement(WonCompletionDialog, {
    open: true,
    deal: DEAL,
    onClose: () => { state.closed++; },
    onWon: () => { state.won++; },
    onNeedSlot: (p) => { state.needSlot = p; },
    ...props,
  })));
  // Seed effect + debounced probe (200ms) + response.
  await act(async () => { await sleep(320); });
  return {
    state,
    unmount: async () => { await act(async () => root.unmount()); mountRoot.remove(); },
  };
}

async function click(el) {
  await act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  await act(async () => { await sleep(50); });
}

async function setInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => { await sleep(320); });
}

test('the checklist is the SERVER’s — one probe, and its verdict is what shows', async () => {
  readinessFn = () => ({
    activityType: 'private', activityTypeAssumed: false, missing: [{ field: 'tourTime', labelHe: 'שעה' }],
    needsSlot: false, ready: false,
  });
  const ui = await render();
  assert.equal(probes().length, 1, 'exactly one readiness probe on open');
  assert.equal(probes()[0].method, 'POST');
  assert.equal(puts().length, 0, 'opening the form writes NOTHING');
  assert.equal(button('השלם והפוך ל-WON').disabled, true, 'not ready ⇒ disabled');
  await ui.unmount();
});

test('the requirement set updates LIVE as the draft changes', async () => {
  readinessFn = (b) => {
    const missing = [];
    if (!b.draft.participants) missing.push({ field: 'participants', labelHe: 'משתתפים' });
    return { activityType: 'private', missing, needsSlot: false, ready: missing.length === 0 };
  };
  const ui = await render({ deal: { ...DEAL, participants: null, tourTime: '10:00' } });
  assert.equal(button('השלם והפוך ל-WON').disabled, true);
  const input = document.querySelector('input[type="number"]');
  assert.ok(input, 'the participants field is offered because the server said it is missing');
  await setInput(input, '14');
  assert.ok(probes().length >= 2, 'the draft change re-asked the server');
  assert.equal(button('השלם והפוך ל-WON').disabled, false, 'ready ⇒ enabled');
  await ui.unmount();
});

test('ONE canonical PUT carries the completed fields AND status:won', async () => {
  // The server says participants is missing; the operator fills it here.
  readinessFn = (b) => {
    const missing = b.draft.participants ? [] : [{ field: 'participants', labelHe: 'משתתפים' }];
    return { activityType: 'private', missing, needsSlot: false, ready: missing.length === 0 };
  };
  const ui = await render({ deal: { ...DEAL, tourTime: '10:00', participants: null } });
  await setInput(document.querySelector('input[type="number"]'), '14');
  assert.equal(puts().length, 0, 'filling a field saves NOTHING on its own');

  await click(button('השלם והפוך ל-WON'));
  assert.equal(puts().length, 1, 'exactly ONE write — no separate save call');
  const body = puts()[0].body;
  assert.equal(body.participants, 14, 'the completed field rides in it');
  assert.equal(body.status, 'won', 'and so does the status change');
  assert.equal(ui.state.won, 1);
  assert.equal(ui.state.closed, 1);
  await ui.unmount();
});

test('only CHANGED fields travel — an untouched value is never rewritten', async () => {
  readinessFn = () => ({ activityType: 'private', missing: [], needsSlot: false, ready: true });
  const ui = await render({ deal: { ...DEAL, tourTime: '10:00' } });
  await click(button('השלם והפוך ל-WON'));
  const body = puts()[0].body;
  // Nothing was edited, so the patch is only the status (+ no field keys).
  assert.deepEqual(Object.keys(body).sort(), ['status']);
  assert.ok(!('tourDate' in body), 'an untouched date is not re-sent over a newer one');
  assert.ok(!('participants' in body));
  await ui.unmount();
});

test('a double click cannot produce two writes', async () => {
  readinessFn = () => ({ activityType: 'private', missing: [], needsSlot: false, ready: true });
  const ui = await render({ deal: { ...DEAL, tourTime: '10:00' } });
  const btn = button('השלם והפוך ל-WON');
  await act(async () => {
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => { await sleep(100); });
  assert.equal(puts().length, 1, 'the second click landed on a disabled button');
  await ui.unmount();
});

test('a 422 after submit keeps the dialog OPEN with the fresh list — never a fake success', async () => {
  readinessFn = () => ({ activityType: 'private', missing: [], needsSlot: false, ready: true });
  putResult = {
    status: 422,
    body: { error: 'won_requirements_missing', missing: [{ field: 'locationId', labelHe: 'עיר / מיקום' }] },
  };
  const ui = await render({ deal: { ...DEAL, tourTime: '10:00' } });
  await click(button('השלם והפוך ל-WON'));
  assert.equal(ui.state.won, 0, 'WON was NOT reported');
  assert.equal(ui.state.closed, 0, 'the dialog stayed open');
  assert.match(text(), /עדיין חסרים פרטים/);
  assert.match(text(), /עיר \/ מיקום/, 'the FRESH server field is shown');
  await ui.unmount();
});

test('tour_slot_required hands the filled fields to the slot picker — no guessed slot', async () => {
  readinessFn = () => ({ activityType: 'group', missing: [], needsSlot: false, ready: true });
  putResult = { status: 422, body: { error: 'tour_slot_required' } };
  const ui = await render({ deal: { ...DEAL, activityType: 'group', tourTime: '10:00', participants: 8 } });
  await click(button('השלם והפוך ל-WON'));
  assert.equal(ui.state.won, 0, 'nothing pretended to win');
  assert.ok(ui.state.needSlot, 'the slot picker was asked for, with the patch');
  await ui.unmount();
});

test('cancelling changes nothing at all', async () => {
  readinessFn = () => ({ activityType: 'private', missing: [], needsSlot: false, ready: true });
  const ui = await render({ deal: { ...DEAL, tourTime: '10:00' } });
  await click(button('ביטול'));
  assert.equal(puts().length, 0, 'no write of any kind');
  assert.equal(ui.state.won, 0);
  assert.equal(ui.state.closed, 1);
  await ui.unmount();
});
