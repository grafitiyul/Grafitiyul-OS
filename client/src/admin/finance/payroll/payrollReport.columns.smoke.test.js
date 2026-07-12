import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Regression smoke for the Reports column picker — the hidden-cells incident:
// the table body rendered orderedColumns (ALL columns, picker order) while the
// header rendered visibleCols, so unchecking a column removed only its header
// and every body cell stayed in the DOM. These tests RENDER the real
// PayrollReportPage against a mocked report DTO and assert header/body column
// parity under hidden columns — including that a hidden column's CONTENT is
// really gone, and that a general addition (תוספת כללית) renders as a row.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'payroll-report-smoke');

const COLUMNS_KEY = 'payroll.report.columns.v2';
const ALL_KEYS = [
  'date', 'month', 'guide', 'activity', 'kind', 'role',
  'components', 'officeAmount', 'guideAmount', 'status', 'actions',
];

const REPORT = {
  months: ['2026-07'],
  guideOptions: [
    { value: 'guide:13', label: 'דור קורן' },
    { value: 'guide:11', label: 'אביה סדי' },
  ],
  summary: { officeApprovedMinor: 0, guideApprovedMinor: 0, waitingMinor: 0, draftMinor: 0, inquiryMinor: 0 },
  guides: [
    {
      externalPersonId: 'guide:13',
      displayName: 'דור קורן',
      totals: {},
      entries: [
        {
          id: 'e1',
          activityId: 'a1',
          activityTitle: 'סיור פלורנטין',
          sourceType: 'tour_event',
          date: '2026-07-12',
          payrollMonth: '2026-07',
          role: 'guide',
          status: 'waiting_guide',
          guideStatus: 'pending',
          vatStatus: 'exempt',
          hasOverride: false,
          notes: null,
          officeApprovedBy: null,
          lines: [{ name: 'תשלום בסיס', sign: 1, amountMinor: 35000, overridden: false }],
          totals: { vatStatus: 'exempt', totalMinor: 35000, netMinor: 35000, vatMinor: 0 },
        },
      ],
    },
    {
      externalPersonId: 'guide:11',
      displayName: 'אביה סדי',
      totals: {},
      entries: [
        {
          id: 'e2',
          activityId: 'a2',
          activityTitle: 'ישיבת צוות',
          sourceType: 'general',
          date: null,
          payrollMonth: '2026-07',
          role: null,
          status: 'waiting_guide',
          guideStatus: 'pending',
          vatStatus: 'exempt',
          hasOverride: false,
          notes: null,
          officeApprovedBy: null,
          lines: [{ name: 'לפי כמות', sign: 1, amountMinor: 12000, overridden: false }],
          totals: { vatStatus: 'exempt', totalMinor: 12000, netMinor: 12000, vatMinor: 0 },
        },
      ],
    },
  ],
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
let createRoot;
let act;
let PayrollReportPage;

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
  // The realtime hook opens an SSE stream on mount — a quiet stub is enough.
  globalThis.EventSource = class {
    constructor() { this.readyState = 1; }
    close() { this.readyState = 2; }
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.startsWith('/api/payroll/report') ? REPORT : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'payrollReport.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'PayrollReportPage.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  PayrollReportPage = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function renderWithColumns(visible) {
  window.localStorage.removeItem('payroll.report.filters.v3');
  window.localStorage.setItem(
    COLUMNS_KEY,
    JSON.stringify({ visible, order: ALL_KEYS, widths: {} }),
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(React.createElement(MemoryRouter, null, React.createElement(PayrollReportPage))),
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

function columnParity(container) {
  const headers = container.querySelectorAll('thead th');
  const firstRowCells = container.querySelectorAll('tbody tr:first-child td');
  return { headers: headers.length, cells: firstRowCells.length };
}

test('hide one column → header AND body cells disappear together', async () => {
  const visible = ALL_KEYS.filter((k) => k !== 'components');
  const { container, unmount } = await renderWithColumns(visible);
  const { headers, cells } = columnParity(container);
  assert.equal(headers, visible.length, 'headers match the visible set');
  assert.equal(cells, visible.length, 'body cells match the visible set');
  const headText = container.querySelector('thead').textContent;
  assert.ok(!headText.includes('רכיבים'), 'hidden column header is gone');
  const bodyText = container.querySelector('tbody').textContent;
  assert.ok(!bodyText.includes('תשלום בסיס'), 'hidden column CONTENT is gone from body cells');
  assert.ok(bodyText.includes('דור קורן'), 'visible columns still render');
  await unmount();
});

test('hide several columns → every row keeps exact header/cell parity', async () => {
  const visible = ['guide', 'activity', 'officeAmount', 'status'];
  const { container, unmount } = await renderWithColumns(visible);
  assert.equal(container.querySelectorAll('thead th').length, 4);
  for (const tr of container.querySelectorAll('tbody tr')) {
    assert.equal(tr.querySelectorAll('td').length, 4, 'no orphan cells / empty gaps');
  }
  await unmount();
});

test('all columns visible → full parity, and a general addition renders as a row', async () => {
  const { container, unmount } = await renderWithColumns(ALL_KEYS);
  const { headers, cells } = columnParity(container);
  assert.equal(headers, ALL_KEYS.length);
  assert.equal(cells, ALL_KEYS.length);
  const bodyText = container.querySelector('tbody').textContent;
  assert.ok(bodyText.includes('ישיבת צוות'), 'general addition row renders');
  assert.ok(bodyText.includes('תוספת כללית'), 'source label uses the new terminology');
  assert.ok(bodyText.includes('ללא תאריך'), 'dateless addition shows ללא תאריך, never vanishes');
  await unmount();
});
