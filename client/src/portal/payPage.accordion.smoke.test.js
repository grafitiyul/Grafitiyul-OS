import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { formatMinor } from '../lib/money.js';

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

// A multiline office note (paragraph gap + Hebrew + numbers) — must survive
// as multiline in the portal (pre-wrap), never collapsed to one line.
const MULTILINE_NOTE = 'שורה ראשונה\nשורה שנייה\n\nפסקה חדשה עם 123';

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
  // Hourly-style line: ₪40 × 1.5 = ₪60 — the portal shows the breakdown.
  lines: [{ name: 'לפי כמות', sign: 1, amountMinor: 6000, quantity: 1.5, unitPriceMinor: 4000 }],
  totals: { vatStatus: 'exempt', totalMinor: 6000, netMinor: 6000, vatMinor: 0 },
  conversation: [],
  officeNote: MULTILINE_NOTE,
};

// A pending TOUR entry with a deduction line named "ניכוי" — the portal tour
// breakdown must show it as "קיזוז".
const DEDUCTION_TOUR_ENTRY = {
  id: 'de1',
  activityTitle: 'סיור יפו',
  sourceType: 'tour_event',
  date: '2026-07-12',
  payrollMonth: '2026-07',
  role: 'guide',
  guideStatus: 'pending',
  guideApprovedAt: null,
  inquiryStatus: 'none',
  inquiryResolvedAt: null,
  vatStatus: 'exempt',
  vatRate: 18,
  lines: [
    { name: 'תשלום מדריך', sign: 1, amountMinor: 35000, quantity: null, unitPriceMinor: null },
    { name: 'ניכוי', sign: -1, amountMinor: 5000, quantity: null, unitPriceMinor: null },
  ],
  totals: { vatStatus: 'exempt', totalMinor: 30000, netMinor: 30000, vatMinor: 0 },
  conversation: [],
  officeNote: null,
};

const PAY_DTO = {
  month: '2026-07',
  months: ['2026-07'],
  totals: { approvedMinor: 35000, pendingCount: 2 },
  entries: [APPROVED_ENTRY, PENDING_ENTRY, DEDUCTION_TOUR_ENTRY],
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

test('#1 office note keeps its line breaks (pre-wrap), never collapsed', async () => {
  const { container, unmount } = await renderPayPage();
  const noteEl = [...container.querySelectorAll('.whitespace-pre-wrap')].find((el) =>
    el.textContent.includes('שורה ראשונה'),
  );
  assert.ok(noteEl, 'office note is rendered with whitespace-pre-wrap (structure preserved)');
  assert.match(noteEl.className, /break-words/, 'long lines wrap and never overflow horizontally');
  // The exact multiline text is preserved byte-for-byte, incl. the empty line.
  assert.ok(noteEl.textContent.includes('שורה ראשונה\nשורה שנייה\n\nפסקה חדשה עם 123'), 'multiline text intact');
  await unmount();
});

test('#2 hourly line shows the rate × quantity breakdown', async () => {
  const { container, unmount } = await renderPayPage();
  // ₪40 × 1.5 = ₪60 (money formatted via the canonical he-IL formatter).
  assert.ok(
    container.textContent.includes(`${formatMinor(4000)} × 1.5`),
    'rate × quantity breakdown is shown for the hourly line',
  );
  // The prominent total is still present.
  assert.ok(container.textContent.includes(formatMinor(6000)), 'final total remains visible');
  await unmount();
});

test('#3 tour deduction shows "קיזוז", not "ניכוי"', async () => {
  const { container, unmount } = await renderPayPage();
  const text = container.textContent;
  assert.match(text, /סיור יפו/, 'the tour entry renders');
  assert.match(text, /קיזוז/, 'the deduction is labelled קיזוז');
  assert.ok(!text.includes('ניכוי'), 'the old ניכוי label no longer appears in the tour breakdown');
  await unmount();
});
