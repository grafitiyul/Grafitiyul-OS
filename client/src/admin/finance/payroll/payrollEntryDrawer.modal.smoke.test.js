import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Smoke for the focused single-entry editor after its conversion from a
// full-screen slide-over (absolute inset-0) to the canonical centered Dialog.
// Asserts: it mounts as an aria modal with a backdrop, renders the entry, is
// NOT a full-screen inset-0 surface, and (Slice 2) shows ONE editable amount
// column with the calculated value as a subtle hint (no separate מחושב/דריסה/
// סופי columns).

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'payroll-entry-modal-smoke');

const ENTRY = {
  entry: {
    id: 'e1',
    displayName: 'דור קורן',
    externalPersonId: 'guide:13',
    imageUrl: null,
    role: 'guide',
    state: 'active',
    officeStatus: 'draft',
    guideStatus: 'pending',
    inquiryStatus: 'none',
    vatStatus: 'exempt',
    vatRate: 18,
    notes: null,
    officeNote: null,
    lines: [
      { id: 'l1', componentId: 'c1', componentNameHe: 'תשלום פעילות', sign: 1, vatMode: 'net', quantity: null, unitPriceMinor: null, calculatedMinor: 6000, overrideMinor: null, note: null, sortOrder: 10 },
      { id: 'l2', componentId: 'c2', componentNameHe: 'ותק', sign: 1, vatMode: 'net', quantity: null, unitPriceMinor: null, calculatedMinor: 2000, overrideMinor: 7500, note: null, sortOrder: 20 },
    ],
    totals: { vatStatus: 'exempt', totalMinor: 13500, netMinor: 13500, vatMinor: 0 },
  },
  activity: { id: 'a1', sourceType: 'tour_event', titleHe: 'סיור פלורנטין', payrollMonth: '2026-07', date: '2026-07-12', state: 'active', displayStatus: 'draft' },
  tour: { id: 't1', date: '2026-07-12', startTime: '10:00', productName: 'פלורנטין', locationName: 'תל אביב', productVariantId: 'v1' },
  calcContext: null,
  conversation: [],
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
let PayrollEntryDrawer;

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
    const body = u.includes('/api/payroll/entries/') ? ENTRY : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'payrollEntryDrawer.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'PayrollEntryDrawer.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  PayrollEntryDrawer = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(React.createElement(PayrollEntryDrawer, { entryId: 'e1', onClose: () => {} })),
  );
  await act(async () => {}); // flush fetch + effects
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
  assert.match(dialog.className, /fixed inset-0/, 'overlay is fixed (backdrop), positioned over the page');
  assert.match(dialog.className, /bg-black\/40/, 'has a dim backdrop so the page stays visible behind');
  // The old surface was a bare `absolute inset-0` panel filling the pane — gone.
  assert.ok(!container.querySelector('.absolute.inset-0'), 'no full-screen absolute inset-0 surface remains');
  const text = container.textContent;
  assert.ok(text.includes('דור קורן'), 'renders the staff name');
  assert.ok(text.includes('סיור פלורנטין'), 'renders the activity name in the header');
  await unmount();
});

test('single amount column: one editable value per component, calculated shown as a hint only', async () => {
  const { container, unmount } = await mount();
  // No separate calculated/override/final column headers.
  const headText = [...container.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  assert.ok(!headText.includes('דריסה'), 'no separate דריסה (override) column');
  assert.ok(!headText.includes('מחושב'), 'no separate מחושב (calculated) column header');
  assert.ok(!headText.includes('סופי'), 'no separate סופי (final) column header');
  assert.ok(headText.includes('סכום'), 'a single סכום column exists');

  // One editable amount input per component line (2 components → 2 inputs).
  const amountInputs = container.querySelectorAll('input[data-line-amount]');
  assert.equal(amountInputs.length, 2, 'exactly one editable amount field per component');

  // The overridden line (calc 2000 → override 7500) shows the FINAL in the
  // field and exposes the calculated value as a subtle hint.
  const overridden = [...amountInputs].find((el) => el.getAttribute('data-line-amount') === 'l2');
  assert.equal(overridden.value, '75', 'field shows the final (override) value, not the calculated');
  assert.ok(container.textContent.includes('חושב אוטומטית'), 'override reveals the calculated value as a hint');
  await unmount();
});
