import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Month-view height regression: week rows must DIVIDE the available height
// (flex-1 growth inside a min-height column) instead of stacking at a fixed
// 104px and leaving a blank band under four-row months. jsdom does not do
// real layout, so this pins the MECHANISM: the weeks column gets a measured
// minHeight, every week row carries flex-1 growth + the 104px floor, and the
// row count follows the month's real week count (4/5/6).

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'tours-calendar-height-smoke');

let React;
let createRoot;
let act;
let ToursCalendar;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

before(async () => {
  const { window } = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', { url: 'http://localhost/' });
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (url) => {
    const body = String(url).includes('/api/tours/calendar') ? { events: [] } : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  const outfile = path.join(cacheDir, 'ToursCalendar.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'ToursCalendar.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  ToursCalendar = (await import(pathToFileURL(outfile).href)).default;
  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
});

async function renderMonth(anchor) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ToursCalendar, {
        search: '', kind: 'all', statuses: ['scheduled'],
        view: { mode: 'month', anchor },
        onViewState: () => {}, onOpenTour: () => {},
      }),
    );
  });
  return { container, root };
}

function weekRows(container) {
  // week rows = 7-col grids that grow (flex-1) and carry the 104px floor
  return [...container.querySelectorAll('div.grid.grid-cols-7.flex-1')];
}

test('February 2026 (exactly 4 weeks) renders 4 growing rows inside a min-height column', async () => {
  const { container, root } = await renderMonth('2026-02-10');
  const rows = weekRows(container);
  assert.equal(rows.length, 4);
  for (const r of rows) assert.match(r.className, /min-h-\[104px\]/, 'each row keeps the 104px floor');
  const column = rows[0].parentElement;
  assert.match(column.className, /flex-col/);
  assert.ok(parseInt(column.style.minHeight, 10) > 0, 'weeks column received a measured minHeight');
  await act(async () => root.unmount());
});

test('September 2026 (5 weeks) and August 2026 (6 weeks) render 5 and 6 growing rows', async () => {
  for (const [anchor, expected] of [['2026-09-10', 5], ['2026-08-10', 6]]) {
    const { container, root } = await renderMonth(anchor);
    assert.equal(weekRows(container).length, expected, `${anchor} → ${expected} week rows`);
    await act(async () => root.unmount());
  }
});

test('day cells stretch with the row: no fixed min-height left on individual cells', async () => {
  const { container, root } = await renderMonth('2026-02-10');
  const firstRow = weekRows(container)[0];
  for (const cell of firstRow.children) {
    assert.ok(!/min-h-\[104px\]/.test(cell.className), 'the floor lives on the ROW, not the cell — cells fill the row height');
  }
  await act(async () => root.unmount());
});
