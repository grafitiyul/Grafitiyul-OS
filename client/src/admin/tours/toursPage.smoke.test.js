import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Render SMOKE tests for the Tours module — regression for the production
// white-screen: `IconButton is not defined` crashed the POPULATED table (the
// row-actions cell) while the empty state rendered fine, so an empty-state
// check alone proves nothing. These tests really mount the components under
// jsdom and cover all three states: empty list, populated list (the crash
// site), and the Tour page.
//
// node --test cannot parse JSX, so components are transformed once via
// esbuild (already a vite dependency): relative imports are bundled (and
// JSX-transpiled), bare packages stay external and resolve from node_modules —
// giving the tests the SAME react instance they import themselves.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'tours-smoke');

const TOUR_ROW = {
  id: 'tour1',
  kind: 'group_slot',
  status: 'scheduled',
  date: '2026-08-06',
  startTime: '17:00',
  tourLanguage: 'he',
  capacity: 30,
  notes: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  product: { id: 'p1', nameHe: 'סיור גרפיטי בדיקה', nameEn: 'Graffiti Test Tour' },
  productVariant: { id: 'v1', locationId: 'l1', location: { id: 'l1', nameHe: 'תל אביב' }, durationHours: 2 },
  location: { id: 'l1', nameHe: 'תל אביב' },
  activeSeats: 12,
  activeBookings: 2,
  totalBookings: 0,
};

// Tour page payload — one active booking with the customer read-through shape
// the server include produces.
const TOUR_DETAIL = {
  ...TOUR_ROW,
  totalBookings: 1,
  assignments: [],
  bookings: [
    {
      id: 'bk1',
      status: 'active',
      seats: 12,
      deal: {
        id: 'deal1',
        orderNo: 27013,
        title: 'דיל בדיקה קבוצתי',
        status: 'won',
        participants: 12,
        customerInfo: '<p>מידע חשוב</p>',
        organization: { id: 'org1', name: 'חברת בדיקות' },
        organizationUnit: null,
        contacts: [
          {
            roles: ['fieldRep'],
            isPrimary: true,
            contact: {
              id: 'c1',
              firstNameHe: 'ישראל',
              lastNameHe: 'ישראלי',
              firstNameEn: 'Israel',
              lastNameEn: 'Israeli',
              phones: [{ value: '+972501234567' }],
              emails: [{ value: 'israel@example.com' }],
            },
          },
        ],
      },
    },
  ],
};

// Mutable list payload — each test sets what GET /api/tours returns.
let toursList = [];

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let ToursPage;
let TourPage;

// Vite-only asset imports (css / ?url / emoji data) live deep inside the
// TimelineFeed→RichEditor tree — irrelevant to a render smoke; stub them.
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
  // Browser globals BEFORE importing react-dom (jsdom provides the DOM;
  // rAF/ResizeObserver shims for the scheduler + dnd-kit).
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

  // Route-aware fetch stub — the components' only network dependencies.
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (/^\/api\/tours\/tour1(\?|$)/.test(u)) body = TOUR_DETAIL;
    else if (u.startsWith('/api/tours')) body = toursList;
    else if (u.startsWith('/api/people')) body = { people: [] };
    else body = []; // timeline, products, …
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  ToursPage = await bundle(esbuild, 'ToursPage.jsx');
  TourPage = await bundle(esbuild, 'TourPage.jsx');

  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
});

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  // Let mount effects' fetches resolve and re-render.
  await act(async () => {});
  return {
    container,
    unmount: () => act(async () => root.unmount()),
  };
}

test('Tours list renders the empty state with 0 tours', async () => {
  toursList = [];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(ToursPage)),
  );
  assert.match(container.innerHTML, /אין סיורים עדיין/);
  await unmount();
});

test('Tours list renders a populated row incl. the row-action buttons', async () => {
  toursList = [TOUR_ROW];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(ToursPage)),
  );
  const html = container.innerHTML;
  // The row itself (would be absent if the fetch/table path broke).
  assert.match(html, /סיור גרפיטי בדיקה/, 'tour row should render the product name');
  assert.match(html, /תל אביב/, 'tour row should render the city');
  // THE regression: the row-actions cell (IconButton) — edit + cancel for a
  // scheduled group slot, delete for an empty tour.
  assert.match(html, /title="עריכה"/, 'edit action must render');
  assert.match(html, /title="ביטול סיור"/, 'cancel action must render');
  assert.match(html, /מחיקה \(סיור ריק בלבד\)/, 'delete action must render for an empty tour');
  // And the empty state must NOT be showing.
  assert.doesNotMatch(html, /אין סיורים עדיין/);
  await unmount();
});

test('Tour modal renders header, team chips and the participant cards', async () => {
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/admin/tours/tour1'] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, { path: '/admin/tours/:id', element: React.createElement(TourPage) }),
      ),
    ),
  );
  const html = container.innerHTML;
  assert.match(html, /role="dialog"/, 'the tour should render as a modal dialog');
  assert.match(html, /סיור גרפיטי בדיקה/, 'header should show the product');
  assert.match(html, /צוות משובץ/, 'the renamed team section should render');
  assert.match(html, /משתתפים/, 'the renamed participants section should render');
  // Card title is now the CUSTOMER (primary contact), with the org beneath —
  // no longer the deal title.
  assert.match(html, /ישראל ישראלי/, 'the customer name should be the card title');
  assert.match(html, /חברת בדיקות/, 'the organization should render under the customer');
  assert.doesNotMatch(html, /דיל בדיקה קבוצתי/, 'the deal title must NOT be the card title');
  assert.match(html, /טופס שיחת תיאום/, 'the coordination-call placeholder should render inside the card');
  // Cancellation now lives on the Deal — the tour modal must not expose it.
  assert.doesNotMatch(html, /בטל סיור/, 'the cancel-tour action must be removed');
  await unmount();
});
