import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Regression smoke for the Staff working table — the VAT_OPTIONS incident:
// the constant moved to people/config.js but PeopleList kept referencing it
// without an import. The build can't catch a free identifier, so these tests
// RENDER the two crashing paths:
//   1. the inline VAT editor (click the מע״מ cell)
//   2. the bulk-edit dialog (select a row → עריכה קבוצתית)
// and assert both show the canonical option labels.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'people-list-smoke');

const PERSON = {
  id: 'p1',
  externalPersonId: 'ext1',
  displayName: 'דנה כהן',
  email: 'dana@x.il',
  phone: '050-1234567',
  status: 'active',
  lifecycleHint: 'staff',
  portalToken: 'tok1',
  portalEnabled: true,
  team: null,
  profile: { imageUrl: null, vatStatus: 'exempt' },
  toursCount: 2,
  trainingStations: 3,
  trainingTours: 1,
  evaluatorPortalUrl: null,
};

let React;
let MemoryRouter;
let createRoot;
let act;
let PeopleList;

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

  // Make the VAT column visible up front (the shared column state shape).
  window.localStorage.setItem(
    'people.columns',
    JSON.stringify({ visible: ['name', 'vat'], order: ['name', 'vat'], widths: {} }),
  );

  globalThis.fetch = async (url) => {
    const u = String(url);
    let body = {};
    if (u.startsWith('/api/people')) body = { people: [PERSON], upstream: { ok: true } };
    else if (u.startsWith('/api/teams')) body = [{ id: 't1', displayName: 'צוות א' }];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'peopleList.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'PeopleList.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  PeopleList = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function render(el) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(el));
  await act(async () => {}); // flush effects/fetches
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('inline VAT editor renders the canonical options (no ReferenceError)', async () => {
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(PeopleList)),
  );
  // The VAT cell renders the label + an inline-edit trigger.
  assert.match(container.innerHTML, /פטור ממע״מ/);
  const trigger = [...container.querySelectorAll('button[title="לחיצה לעריכה"]')][0];
  assert.ok(trigger, 'inline edit trigger exists');
  await act(async () => trigger.click());
  const select = container.querySelector('td select');
  assert.ok(select, 'inline VAT select opened without crashing');
  const labels = [...select.querySelectorAll('option')].map((o) => o.textContent);
  assert.ok(labels.includes('פטור ממע״מ') && labels.includes('18% מע״מ'), 'canonical VAT options');
  await unmount();
});

test('bulk-edit dialog renders with the canonical VAT options (no ReferenceError)', async () => {
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(PeopleList)),
  );
  const rowCheckbox = container.querySelector('input[aria-label="בחירת דנה כהן"]');
  assert.ok(rowCheckbox, 'row selection checkbox exists');
  await act(async () => rowCheckbox.click());
  const bulkBtn = [...container.querySelectorAll('button')].find((b) =>
    b.textContent.includes('עריכה קבוצתית'),
  );
  assert.ok(bulkBtn, 'bulk edit button appears after selection');
  await act(async () => bulkBtn.click());
  const html = container.innerHTML;
  assert.match(html, /עריכה קבוצתית/);
  assert.match(html, /תוספת ותק/);
  assert.match(html, /פטור ממע״מ/); // the VAT select rendered → no crash
  await unmount();
});
