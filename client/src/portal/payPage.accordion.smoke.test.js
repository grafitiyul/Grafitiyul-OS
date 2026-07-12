import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Guide Portal Pay page — approved-entries accordion (presentation only).
// Renders the REAL PayPage against a mocked portal DTO and asserts:
//   • a guide-approved entry rests COLLAPSED: summary (title, amount,
//     "אושר על ידך") visible, components/breakdown hidden
//   • tapping it expands the full detail (components, office note, approval
//     details) and it can be collapsed again
//   • a pending entry stays fully expanded and prominent (approve button)

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'pay-page-smoke');

const APPROVED_ENTRY = {
  id: 'ap1',
  activityTitle: 'סיור פלורנטין',
  sourceType: 'tour_event',
  date: '2026-07-10',
  payrollMonth: '2026-07',
  role: 'guide',
  guideStatus: 'approved',
  guideApprovedAt: '2026-07-11T09:00:00.000Z',
  inquiryStatus: 'none',
  inquiryResolvedAt: null,
  vatStatus: 'exempt',
  vatRate: 18,
  lines: [{ name: 'תשלום בסיס', sign: 1, amountMinor: 35000 }],
  totals: { vatStatus: 'exempt', totalMinor: 35000, netMinor: 35000, vatMinor: 0 },
  conversation: [],
  officeNote: 'תודה על הסיור!',
};

const PENDING_ENTRY = {
  id: 'pe1',
  activityTitle: 'ישיבת צוות',
  sourceType: 'general',
  date: null,
  payrollMonth: '2026-07',
  role: null,
  guideStatus: 'pending',
  guideApprovedAt: null,
  inquiryStatus: 'none',
  inquiryResolvedAt: null,
  vatStatus: 'exempt',
  vatRate: 18,
  lines: [{ name: 'לפי כמות', sign: 1, amountMinor: 12000 }],
  totals: { vatStatus: 'exempt', totalMinor: 12000, netMinor: 12000, vatMinor: 0 },
  conversation: [],
  officeNote: null,
};

const PAY_DTO = {
  month: '2026-07',
  months: ['2026-07'],
  totals: { approvedMinor: 35000, pendingCount: 1 },
  entries: [APPROVED_ENTRY, PENDING_ENTRY],
};

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

let React;
let MemoryRouter;
let Routes;
let Route;
let Outlet;
let createRoot;
let act;
let PayPage;

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
  globalThis.EventSource = class {
    constructor() { this.readyState = 1; }
    close() { this.readyState = 2; }
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/pay') ? PAY_DTO : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'payPage.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'PayPage.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  PayPage = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter, Routes, Route, Outlet } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

// PayPage reads { token } from the router outlet context — mimic PortalShell.
function Shell() {
  return React.createElement(Outlet, { context: { token: 'tok1' } });
}

async function renderPayPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          Routes,
          null,
          React.createElement(
            Route,
            { path: '/', element: React.createElement(Shell) },
            React.createElement(Route, { index: true, element: React.createElement(PayPage) }),
          ),
        ),
      ),
    ),
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

test('approved entry rests collapsed: summary visible, breakdown hidden', async () => {
  const { container, unmount } = await renderPayPage();
  const html = container.innerHTML;
  assert.match(html, /סיור פלורנטין/, 'approved card title visible');
  assert.match(html, /אושר על ידך/, 'approved status visible');
  assert.ok(!html.includes('תשלום בסיס'), 'approved card components are hidden while collapsed');
  assert.ok(!html.includes('תודה על הסיור!'), 'office note body hidden while collapsed');
  assert.match(html, /📌 הערת משרד/, 'compact office-note indicator shows on the collapsed card');
  await unmount();
});

test('tapping an approved card expands full detail; tapping again collapses', async () => {
  const { container, unmount } = await renderPayPage();
  const card = [...container.querySelectorAll('button')].find((b) =>
    b.textContent.includes('סיור פלורנטין'),
  );
  assert.ok(card, 'collapsed approved card is a tappable button');
  await act(async () => card.click());
  let html = container.innerHTML;
  assert.match(html, /תשלום בסיס/, 'components render after expand');
  assert.match(html, /תודה על הסיור!/, 'office note renders after expand');
  assert.match(html, /אושר על ידך ·/, 'approval details render after expand');
  const toggle = [...container.querySelectorAll('button[aria-expanded]')].find((b) =>
    b.textContent.includes('סיור פלורנטין'),
  );
  await act(async () => toggle.click());
  html = container.innerHTML;
  assert.ok(!html.includes('תשלום בסיס'), 'collapses back on tap');
  await unmount();
});

test('pending entry stays fully expanded with the approve action', async () => {
  const { container, unmount } = await renderPayPage();
  const html = container.innerHTML;
  assert.match(html, /ישיבת צוות/);
  assert.match(html, /לפי כמות/, 'pending entry breakdown is visible without any tap');
  assert.match(html, /אשר ✓/, 'approve button prominent');
  assert.match(html, /תוספת כללית/, 'general source label uses the new terminology');
  await unmount();
});
