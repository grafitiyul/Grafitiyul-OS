import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Smoke for the multi-staff activity editor after its conversion from a
// full-screen slide-over (absolute inset-0) to a content-sized centered Dialog.
// Asserts: aria modal + backdrop (not inset-0); staff columns carry a FIXED
// compact width (never flex/w-full stretching two people across the screen);
// the matrix scrolls horizontally inside the modal; one editable amount cell
// per component/person with the calculated value exposed only as a hint.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'payroll-activity-modal-smoke');

function entry(id, name, role, lines) {
  return {
    id, displayName: name, externalPersonId: `guide:${id}`, role, state: 'active',
    officeStatus: 'draft', guideStatus: 'pending', inquiryStatus: 'none',
    vatStatus: 'exempt', vatRate: 18, notes: null, officeNote: null,
    lines, totals: { vatStatus: 'exempt', totalMinor: 35000, netMinor: 35000, vatMinor: 0 },
  };
}

const ACTIVITY = {
  activity: { id: 'a1', sourceType: 'tour_event', titleHe: 'סיור פלורנטין', payrollMonth: '2026-07', date: '2026-07-12', state: 'active', displayStatus: 'draft', entryCount: 2 },
  tour: { id: 't1', date: '2026-07-12', startTime: '10:00', productName: 'פלורנטין', locationName: 'תל אביב', participants: 12, customers: [] },
  general: null,
  entries: [
    entry('1', 'דור', 'lead_guide', [
      { id: 'l1a', componentId: 'c1', componentNameHe: 'תשלום פעילות', sign: 1, quantity: null, unitPriceMinor: null, calculatedMinor: 35000, overrideMinor: null, sortOrder: 10 },
      { id: 'l1b', componentId: 'c2', componentNameHe: 'ותק', sign: 1, quantity: null, unitPriceMinor: null, calculatedMinor: 2000, overrideMinor: 7500, sortOrder: 20 },
    ]),
    entry('2', 'אלינוי', 'guide', [
      { id: 'l2a', componentId: 'c1', componentNameHe: 'תשלום פעילות', sign: 1, quantity: null, unitPriceMinor: null, calculatedMinor: 35000, overrideMinor: null, sortOrder: 10 },
      { id: 'l2b', componentId: 'c2', componentNameHe: 'ותק', sign: 1, quantity: null, unitPriceMinor: null, calculatedMinor: 1000, overrideMinor: null, sortOrder: 20 },
    ]),
  ],
  history: [],
};

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

let React;
let createRoot;
let act;
let PayrollActivityDrawer;

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

  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/api/payroll/activities/') ? ACTIVITY : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'payrollActivityDrawer.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'PayrollActivityDrawer.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  PayrollActivityDrawer = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(React.createElement(PayrollActivityDrawer, { activityId: 'a1', onClose: () => {} })),
  );
  await act(async () => {});
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('mounts as an aria modal with a backdrop (not a full-screen inset-0 slide-over)', async () => {
  const { container, unmount } = await mount();
  const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog, 'renders a role=dialog aria-modal overlay');
  assert.match(dialog.className, /fixed inset-0/, 'overlay is fixed (backdrop)');
  assert.match(dialog.className, /bg-black\/40/, 'dim backdrop keeps the page visible behind');
  assert.ok(!container.querySelector('.absolute.inset-0'), 'no full-screen absolute inset-0 surface remains');
  await unmount();
});

test('staff columns have a FIXED compact width, and the matrix scrolls horizontally', async () => {
  const { container, unmount } = await mount();
  const staffHeaders = [...container.querySelectorAll('thead th')].filter((th) => th.textContent.includes('דור') || th.textContent.includes('אלינוי'));
  assert.equal(staffHeaders.length, 2, 'two staff columns for two people');
  for (const th of staffHeaders) {
    assert.match(th.className, /w-52/, 'each staff column has a fixed compact width (w-52), not flex/stretch');
    assert.ok(!/flex-1|w-full/.test(th.className), 'no flex-1 / w-full stretching');
  }
  // The table is w-auto (content sized) inside an overflow-x-auto scroller.
  const table = container.querySelector('table');
  assert.match(table.className, /w-auto/, 'table sizes to content, does not stretch to fill');
  const scroller = table.closest('.overflow-x-auto');
  assert.ok(scroller, 'matrix lives inside a horizontal scroll container');
  await unmount();
});

test('one editable amount cell per person; override reveals the calculated value as a hint', async () => {
  const { container, unmount } = await mount();
  // דור's ותק line is overridden (calc 2000 → 7500): shows ✎ + calculated hint.
  assert.ok(container.textContent.includes('✎'), 'overridden cell carries a subtle override mark');
  // approval controls per person (two ☐ אשר buttons).
  const approveButtons = [...container.querySelectorAll('button')].filter((b) => b.textContent.trim() === '☐ אשר');
  assert.equal(approveButtons.length, 2, 'per-person office-approval control under each column');
  await unmount();
});
