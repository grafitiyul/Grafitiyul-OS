import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Calendar navigation regression — BOTH halves of the production bug:
//   1. RENDERED SEMANTICS: the previous-button glyph must point RIGHT and the
//      next-button glyph LEFT (Hebrew RTL — days run right→left), and each
//      glyph must sit inside a dir="ltr" bidi-isolation span. Without the
//      isolation the chevrons (‹›❮❯ — all Bidi_Mirrored=Yes) flip under the
//      page's dir="rtl", making the icon disagree with the action.
//   2. DATE MOVEMENT: clicking "הקודם" goes back in time and "הבא" forward,
//      in month, week and day modes, across month/year boundaries.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'tours-calendar-nav-smoke');

// Right/left-pointing per Unicode names (U+276F / U+276E) — NOT mirrored here
// because NavButton isolates them with dir="ltr".
const RIGHT_POINTING = '❯';
const LEFT_POINTING = '❮';

let React;
let createRoot;
let act;
let ToursCalendar;
let viewState = null; // captured from onViewState — the anchor is the date SSOT

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

async function renderCalendar(anchor, mode = 'month') {
  viewState = { mode, anchor };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ToursCalendar, {
        search: '',
        kind: 'all',
        status: 'active',
        view: { mode, anchor },
        onViewState: (v) => {
          viewState = v;
        },
        onOpenTour: () => {},
      }),
    );
  });
  await act(async () => {});
  return { container, unmount: () => act(async () => root.unmount()) };
}

const btn = (container, label) => container.querySelector(`button[aria-label="${label}"]`);
const click = (el) => act(async () => el.click());

test('rendered semantics: previous points RIGHT, next points LEFT, glyphs bidi-isolated with dir="ltr"', async () => {
  const { container, unmount } = await renderCalendar('2026-07-15');
  const prev = btn(container, 'הקודם');
  const next = btn(container, 'הבא');
  assert.ok(prev && next, 'both nav buttons rendered');

  // Icon direction — the label (action) and the glyph (visual) must agree.
  assert.equal(prev.textContent.trim(), RIGHT_POINTING, 'previous glyph points right (RTL past side)');
  assert.equal(next.textContent.trim(), LEFT_POINTING, 'next glyph points left (RTL future side)');

  // Bidi isolation — without dir="ltr" the mirrored chevrons flip under RTL
  // and the assertion above would be meaningless in a real browser.
  for (const b of [prev, next]) {
    const iso = b.querySelector('span[dir="ltr"]');
    assert.ok(iso, 'glyph wrapped in a dir="ltr" isolation span');
    assert.equal(iso.textContent.trim().length, 1, 'isolation span holds exactly the glyph');
  }

  // DOM order inside the RTL flex row: previous first (rendered right-most).
  const buttons = [...container.querySelectorAll('button[aria-label]')];
  assert.ok(
    buttons.indexOf(prev) < buttons.indexOf(next),
    'previous precedes next in DOM — right-most under dir="rtl"',
  );
  await unmount();
});

test('month mode: הקודם goes one month back, הבא one month forward (incl. year boundary)', async () => {
  const { container, unmount } = await renderCalendar('2026-07-15');
  assert.match(container.textContent, /יולי 2026/);

  await click(btn(container, 'הקודם'));
  assert.match(container.textContent, /יוני 2026/);
  assert.equal(viewState.anchor, '2026-06-01');

  await click(btn(container, 'הבא'));
  await click(btn(container, 'הבא'));
  assert.match(container.textContent, /אוגוסט 2026/);
  assert.equal(viewState.anchor, '2026-08-01');
  await unmount();

  // Year boundary both directions.
  const jan = await renderCalendar('2026-01-10');
  await click(btn(jan.container, 'הקודם'));
  assert.match(jan.container.textContent, /דצמבר 2025/);
  await click(btn(jan.container, 'הבא'));
  await click(btn(jan.container, 'הבא'));
  assert.match(jan.container.textContent, /פברואר 2026/);
  await jan.unmount();
});

test('week mode: הקודם/הבא move exactly one week, crossing month boundaries', async () => {
  // 2026-07-15 is a Wednesday — its Sunday-first week is 12/07–18/07.
  const { container, unmount } = await renderCalendar('2026-07-15', 'week');
  assert.match(container.textContent, /12\/07 – 18\/07/);

  await click(btn(container, 'הקודם'));
  assert.equal(viewState.anchor, '2026-07-08');
  assert.match(container.textContent, /05\/07 – 11\/07/);

  await click(btn(container, 'הבא'));
  await click(btn(container, 'הבא'));
  await click(btn(container, 'הבא'));
  assert.equal(viewState.anchor, '2026-07-29');
  // Week 26/07–01/08 crosses into August.
  assert.match(container.textContent, /26\/07 – 01\/08/);
  await unmount();
});

test('day mode: הקודם/הבא move exactly one day, crossing month boundaries', async () => {
  const { container, unmount } = await renderCalendar('2026-08-01', 'day');
  await click(btn(container, 'הקודם'));
  assert.equal(viewState.anchor, '2026-07-31', 'previous from Aug 1 is Jul 31');

  await click(btn(container, 'הבא'));
  await click(btn(container, 'הבא'));
  assert.equal(viewState.anchor, '2026-08-02', 'next moves forward one day at a time');
  await unmount();
});
