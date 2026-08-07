import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Nested entity references inside a global-search result — RENDERS the real
// GlobalSearch (esbuild bundle, jsdom) against a recording fetch stub and
// proves the contract the feature actually promises:
//
//   1. hovering a Contact named on a DEAL row opens a peek card with the
//      canonical details — after the intentional delay, not instantly;
//   2. the hover NAVIGATES NOTHING, WRITES NOTHING and does not close the
//      search panel;
//   3. clicking that Contact name opens the CONTACT, not the deal;
//   4. clicking anywhere else on the same row still opens the DEAL;
//   5. an Organization name behaves identically, and its card shows the type;
//   6. a row whose server payload carries no ref renders plain text — the old
//      behaviour — rather than a broken link.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'entity-peek-smoke');

const DEAL_RESULT = {
  type: 'deal',
  id: 'd1',
  orderNo: 27100,
  path: '/admin/crm/deals/27100',
  title: 'ליד חדש - סיור גרפיטי',
  contactName: 'דנה כהן',
  contactRef: { type: 'contact', id: 'c1', name: 'דנה כהן', path: '/admin/crm/contacts/50123' },
  organizationName: 'סמסונג',
  organizationRef: {
    type: 'organization', id: 'o1', name: 'סמסונג',
    path: '/admin/crm/organizations/10001', unitId: 'u1', unitName: 'HR',
  },
  organizationSubtypeLabel: 'מורים',
  unitName: 'HR',
  status: 'open',
  stageLabel: 'ליד חדש',
  reasons: [],
};

// The same row shape a legacy/unresolvable payload produces: names, no refs.
const REFLESS_RESULT = {
  ...DEAL_RESULT,
  id: 'd2',
  orderNo: 27101,
  path: '/admin/crm/deals/27101',
  title: 'דיל בלי קישורים',
  contactRef: null,
  organizationRef: null,
};

const CONTACT_PEEK = {
  type: 'contact',
  id: 'c1',
  path: '/admin/crm/contacts/50123',
  nameHe: 'דנה כהן',
  nameEn: 'Dana Cohen',
  phones: [{ value: '0521234567', label: 'נייד' }],
  emails: [{ value: 'dana@example.com', label: null }],
  organizations: [{ id: 'o1', name: 'סמסונג', path: '/admin/crm/organizations/10001', unitName: 'HR', role: null, isPrimary: true }],
  moreOrganizations: 0,
  dealCount: 3,
};

const ORG_PEEK = {
  type: 'organization',
  id: 'o1',
  path: '/admin/crm/organizations/10001',
  name: 'סמסונג',
  typeLabel: 'חברה עסקית',
  units: [{ id: 'u1', name: 'HR' }],
  moreUnits: 0,
  dealCount: 12,
  contactCount: 5,
};

let calls = [];
let dealResults = [DEAL_RESULT];

let React;
let MemoryRouter;
let useLocation;
let createRoot;
let act;
let GlobalSearch;

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
    calls.push({ url: u, method });
    let body = {};
    if (u.includes('/api/search/peek')) {
      const params = new URL(u, 'http://localhost').searchParams;
      body = params.get('type') === 'contact' ? CONTACT_PEEK : ORG_PEEK;
    } else if (u.includes('/api/search')) {
      body = {
        groups: [{ category: 'deals', label: 'עסקאות', total: dealResults.length, truncated: false, results: dealResults }],
        truncated: false,
      };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'globalSearch.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'GlobalSearch.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  GlobalSearch = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter, useLocation } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  calls = [];
  dealResults = [DEAL_RESULT];
  window.localStorage.clear();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOVER_DELAY = 350;

function LocationProbe() {
  const loc = useLocation();
  return React.createElement('span', { 'data-loc': loc.pathname });
}

async function render() {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  await act(async () => root.render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/admin'] },
      React.createElement(GlobalSearch),
      React.createElement(LocationProbe),
    ),
  ));
  await act(async () => {});
  return {
    input: mountRoot.querySelector('input[type="text"]'),
    location: () => document.querySelector('[data-loc]')?.getAttribute('data-loc'),
    unmount: async () => { await act(async () => root.unmount()); mountRoot.remove(); },
  };
}

async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => { await sleep(320); });
}

/** The peekable name spans on the rendered rows, in DOM order. */
const peekTriggers = () => [...document.querySelectorAll('[role="link"]')];
const findTrigger = (text) => peekTriggers().find((el) => el.textContent.trim() === text) || null;
const panelOpen = () => !!document.getElementById('global-search-results');
const cardText = () => [...document.querySelectorAll('[data-floating-panel]')]
  .map((el) => el.textContent)
  .join(' ');

async function hover(el) {
  await act(async () => {
    el.parentElement.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    el.parentElement.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
  });
}

async function press(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

test('the contact and organization named on a deal row become targets', async () => {
  const ui = await render();
  await type(ui.input, 'דנה');
  assert.ok(findTrigger('דנה כהן'), 'the contact name is interactive');
  assert.ok(findTrigger('סמסונג'), 'the organization name is interactive');
  // The unit is NOT — it has no page of its own.
  assert.equal(findTrigger('HR'), null);
  await ui.unmount();
});

test('hover opens the card only after the intentional delay, and fetches once', async () => {
  const ui = await render();
  await type(ui.input, 'דנה');
  calls = [];
  const trigger = findTrigger('דנה כהן');

  await hover(trigger);
  await act(async () => { await sleep(HOVER_DELAY - 200); });
  assert.equal(calls.filter((c) => c.url.includes('/peek')).length, 0, 'a passing pointer fetches nothing');

  await act(async () => { await sleep(400); });
  const peeks = calls.filter((c) => c.url.includes('/api/search/peek'));
  assert.equal(peeks.length, 1, 'exactly one peek request');
  assert.match(peeks[0].url, /type=contact/);
  assert.match(peeks[0].url, /id=c1/);
  assert.equal(peeks[0].method, 'GET', 'a peek is a pure READ');

  const text = cardText();
  assert.match(text, /דנה כהן/);
  assert.match(text, /052/, 'the phone is shown');
  assert.match(text, /dana@example\.com/, 'the email is shown');
  assert.match(text, /סמסונג/, 'the linked organization is shown');
  await ui.unmount();
});

test('hovering navigates nothing, writes nothing and keeps the panel open', async () => {
  const ui = await render();
  await type(ui.input, 'דנה');
  calls = [];
  await hover(findTrigger('דנה כהן'));
  await act(async () => { await sleep(500); });

  assert.equal(ui.location(), '/admin', 'no navigation');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'no writes of any kind');
  assert.ok(panelOpen(), 'the search dropdown stays open');
  assert.equal(ui.input.value, 'דנה', 'the query is untouched');
  await ui.unmount();
});

test('clicking the contact name opens the CONTACT, not the deal', async () => {
  const ui = await render();
  await type(ui.input, 'דנה');
  await press(findTrigger('דנה כהן'));
  assert.equal(ui.location(), '/admin/crm/contacts/50123');
  assert.ok(!panelOpen(), 'the search closes behind it');
  await ui.unmount();
});

test('clicking the organization name opens the ORGANIZATION, and its card shows the type', async () => {
  const ui = await render();
  await type(ui.input, 'דנה');
  await hover(findTrigger('סמסונג'));
  await act(async () => { await sleep(500); });
  assert.match(cardText(), /חברה עסקית/, 'the organization type');
  assert.match(cardText(), /מורים/, 'the DEAL-owned subtype, marked as coming from the deal');

  await press(findTrigger('סמסונג'));
  assert.equal(ui.location(), '/admin/crm/organizations/10001');
  await ui.unmount();
});

test('clicking anywhere else on the row still opens the DEAL', async () => {
  const ui = await render();
  await type(ui.input, 'דנה');
  const title = [...document.querySelectorAll('.gos-title')]
    .find((el) => el.textContent.includes('ליד חדש - סיור גרפיטי'));
  await press(title);
  assert.equal(ui.location(), '/admin/crm/deals/27100');
  await ui.unmount();
});

test('a row with no refs renders plain text and still opens the deal', async () => {
  dealResults = [REFLESS_RESULT];
  const ui = await render();
  await type(ui.input, 'דנה');
  assert.equal(peekTriggers().length, 0, 'no interactive names without a ref');
  const name = [...document.querySelectorAll('.gos-subject')]
    .find((el) => el.textContent.trim() === 'דנה כהן');
  assert.ok(name, 'the name is still SHOWN — nothing was removed to make room');
  await press(name);
  assert.equal(ui.location(), '/admin/crm/deals/27101', 'the row behaves exactly as before');
  await ui.unmount();
});
