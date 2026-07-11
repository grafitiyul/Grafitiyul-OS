import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { STAFF_COLORS } from '../../../shared/staffColors.mjs';

// Staff color picker — regression suite for two production issues:
//   1. the inline Staff-table popover was absolutely positioned INSIDE the
//      table cell, so the card's overflow-hidden / overflow-x-auto clipped
//      the palette. It must open through the shared AnchoredMenu portal on
//      <body> (flip above when the bottom is tight, clamp into the viewport).
//   2. the palette had no plain yellow — 'yellow' / צהוב is a NEW key that
//      every consumer (profile, inline table, bulk edit) picks up from the
//      one canonical shared palette.
//
// Same jsdom + esbuild harness as the tours render-smoke tests: components
// really mount; bare packages stay external so tests share the react instance.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'staff-color-picker');

const PERSON = {
  id: 'p1',
  displayName: 'דנה מדריכה',
  phone: '0501234567',
  email: 'dana@example.com',
  status: 'active',
  lifecycleHint: 'staff',
  portalEnabled: true,
  portalToken: 'tok1',
  teamRefId: null,
  team: null,
  profile: { displayColor: 'coral', imageUrl: null },
  toursCount: 0,
  trainingStations: 0,
  trainingTours: 0,
};

let React;
let MemoryRouter;
let createRoot;
let act;
let StaffColorPicker;
let AnchoredMenu;
let PeopleList;
let fetchCalls = [];

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({
      path: args.path,
      namespace: 'asset-stub',
    }));
    build.onResolve({ filter: /^emoji-picker-element/ }, (args) => ({
      path: args.path,
      namespace: 'asset-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({
      contents: 'export default "";',
      loader: 'js',
    }));
  },
};

async function bundle(esbuild, entry) {
  const outfile = path.join(cacheDir, `${path.basename(entry, '.jsx')}.bundle.mjs`);
  await esbuild.build({
    entryPoints: [path.join(here, entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  return (await import(pathToFileURL(outfile).href)).default;
}

before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
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

  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: options.method || 'GET', body: options.body });
    let body;
    if (u.startsWith('/api/people') && (options.method || 'GET') !== 'GET') body = {};
    else if (u.startsWith('/api/people')) body = { people: [PERSON], upstream: { ok: true } };
    else if (u.startsWith('/api/teams')) body = [];
    else body = [];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  StaffColorPicker = await bundle(esbuild, 'StaffColorPicker.jsx');
  AnchoredMenu = await bundle(esbuild, '../admin/common/AnchoredMenu.jsx');
  PeopleList = await bundle(esbuild, '../admin/people/PeopleList.jsx');

  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
});

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await act(async () => {}); // flush mount-effect fetches
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('shared picker renders the FULL canonical palette — incl. the new yellow', async () => {
  const { container, unmount } = await render(
    React.createElement(StaffColorPicker, { value: null, onPick: () => {} }),
  );
  const swatches = container.querySelectorAll('button[aria-pressed]');
  assert.equal(swatches.length, STAFF_COLORS.length, 'one swatch per palette color');
  const yellow = container.querySelector('button[aria-label="צהוב"]');
  assert.ok(yellow, 'the yellow swatch renders (same picker serves profile + bulk edit)');
  assert.match(yellow.getAttribute('style') || '', /250,\s*204,\s*21|#FACC15/i, 'clearly-yellow hex');
  // DOM order mirrors the canonical array — yellow sits in the warm family,
  // right before gold (not dumped at the end).
  const labels = [...swatches].map((b) => b.getAttribute('aria-label'));
  assert.equal(labels.indexOf('צהוב'), labels.indexOf('זהב') - 1, 'yellow placed next to gold');
  assert.match(container.innerHTML, /ללא צבע/, 'the clear option renders');
  await unmount();
});

test('AnchoredMenu flips above a bottom-edge anchor and clamps into the viewport', async () => {
  // A real DOM anchor pinned near the bottom-left of the 1024×768 jsdom
  // viewport; the menu (282 wide, 200 tall) cannot fit below or fully to
  // the start — it must flip up and clamp inward.
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({
    top: 740, bottom: 750, left: 80, right: 100, width: 20, height: 10, x: 80, y: 740,
  });
  const heightDesc = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return 200; },
  });
  try {
    const { unmount } = await render(
      React.createElement(
        AnchoredMenu,
        { anchorRef: { current: anchor }, open: true, onClose: () => {}, width: 282, align: 'end' },
        React.createElement(StaffColorPicker, { compact: true, value: null, onPick: () => {} }),
      ),
    );
    const yellow = document.querySelector('button[aria-label="צהוב"]');
    assert.ok(yellow, 'palette rendered through the portal');
    let panel = yellow;
    while (panel.parentElement !== document.body) panel = panel.parentElement;
    assert.equal(panel.style.position, 'fixed', 'viewport-fixed positioning');
    // flip: below would end at 750+4+200=954 > 768−8 → open above: 740−4−200
    assert.equal(panel.style.top, '536px', 'flips above the anchor');
    // clamp: align-end start would be 100−282=−182 → clamped to the 8px margin
    assert.equal(panel.style.left, '8px', 'clamped inside the viewport');
    await unmount();
  } finally {
    if (heightDesc) Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', heightDesc);
    else delete window.HTMLElement.prototype.offsetHeight;
    anchor.remove();
  }
});

test('inline Staff-table picker opens via the shared portal — never clipped by the table', async () => {
  fetchCalls = [];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(PeopleList)),
  );
  assert.match(container.innerHTML, /דנה מדריכה/, 'the roster row rendered');

  // The color cell trigger wraps the person's current swatch (coral).
  const swatch = container.querySelector('span[title="coral"]');
  assert.ok(swatch, 'current color swatch renders in the table');
  const trigger = swatch.closest('button');
  assert.ok(trigger, 'the color cell is click-to-edit');

  await act(async () => { trigger.click(); });
  const yellow = document.querySelector('button[aria-label="צהוב"]');
  assert.ok(yellow, 'palette opened — with the yellow option');
  // THE clipping regression: the palette must live OUTSIDE the table subtree
  // (portal on <body>), where overflow-hidden/overflow-x-auto cannot cut it.
  assert.ok(!container.contains(yellow), 'palette portaled outside the app subtree');
  const table = container.querySelector('table');
  assert.ok(table && !table.contains(yellow), 'palette is NOT inside the table');
  let panel = yellow;
  while (panel.parentElement !== document.body) panel = panel.parentElement;
  assert.equal(panel.style.position, 'fixed', 'panel positions against the viewport');

  // Escape closes without saving.
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  assert.ok(!document.querySelector('button[aria-label="צהוב"]'), 'Escape closes the palette');
  assert.ok(
    !fetchCalls.some((c) => c.method === 'PUT'),
    'Escape must not persist anything',
  );

  // Re-open and pick yellow → saves through the SAME profile endpoint.
  await act(async () => { trigger.click(); });
  await act(async () => { document.querySelector('button[aria-label="צהוב"]').click(); });
  const put = fetchCalls.find((c) => c.url === '/api/people/p1/profile' && c.method === 'PUT');
  assert.ok(put, 'picking a color saves via updateProfile');
  assert.equal(JSON.parse(put.body).displayColor, 'yellow');
  assert.ok(!document.querySelector('button[aria-label="צהוב"]'), 'palette closes after picking');
  await unmount();
});
