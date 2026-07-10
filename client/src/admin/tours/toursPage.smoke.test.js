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
  assignments: [
    {
      id: 'as1',
      role: 'lead_guide',
      personRefId: 'p1',
      personRef: { id: 'p1', displayName: 'דנה מדריכה' },
      displayName: 'דנה מדריכה',
    },
  ],
  // A non-workshop component (no location UI) + a workshop component (with a
  // location) — the tour modal's "מרכיבי הפעילות" section.
  activityComponents: [
    {
      id: 'tc1',
      activityComponentId: 'ac1',
      workshopLocationId: null,
      sortOrder: 0,
      activityComponent: { id: 'ac1', nameHe: 'סיור גרפיטי', icon: '🎨', color: 'violet', isWorkshop: false, isActive: true },
      workshopLocation: null,
    },
    {
      id: 'tc2',
      activityComponentId: 'ac2',
      workshopLocationId: 'wl1',
      sortOrder: 1,
      activityComponent: { id: 'ac2', nameHe: 'סדנת תקליטים', icon: '🎧', color: 'blue', isWorkshop: true, isActive: true },
      workshopLocation: { id: 'wl1', nameHe: 'סטודיו תל אביב' },
    },
  ],
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
let TimelineFeed;
let TourComponents;
let TourTeamEditor;
let DealTourSummary;
let VariantDefaultComponents;

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
    else if (u.startsWith('/api/people'))
      body = {
        people: [
          { id: 'p2', displayName: 'אבי כהן', status: 'active', profile: { imageUrl: null } },
          { id: 'p3', displayName: 'דור לוי', status: 'active', profile: null },
        ],
      };
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
  TimelineFeed = await bundle(esbuild, '../common/timeline/TimelineFeed.jsx');
  TourComponents = await bundle(esbuild, 'TourComponents.jsx');
  TourTeamEditor = await bundle(esbuild, 'TourTeamEditor.jsx');
  DealTourSummary = await bundle(esbuild, 'DealTourSummary.jsx');
  VariantDefaultComponents = await bundle(esbuild, '../products/VariantDefaultComponents.jsx');

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
    // Unmount AND detach the container — later tests assert against
    // document.body (portal-rendered popovers), so leftovers must not linger.
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
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
  // The shared team editor renders the assigned guide + role (same component the
  // Deal reuses).
  assert.match(html, /דנה מדריכה/, 'the assigned guide renders via the shared team editor');
  assert.match(html, /מדריך ראשי/, 'the guide role label renders');
  assert.match(html, /משתתפים/, 'the renamed participants section should render');
  // Card title is now the CUSTOMER (primary contact), with the org beneath —
  // no longer the deal title.
  assert.match(html, /ישראל ישראלי/, 'the customer name should be the card title');
  assert.match(html, /חברת בדיקות/, 'the organization should render under the customer');
  assert.doesNotMatch(html, /דיל בדיקה קבוצתי/, 'the deal title must NOT be the card title');
  assert.match(html, /טופס שיחת תיאום/, 'the coordination-call placeholder should render inside the card');
  // The header activity badge reuses the Deal's vocabulary — a group slot maps
  // to activityType 'group' → "קבוצתי" (not the removed kind chip "עסקי").
  assert.match(html, /קבוצתי/, 'the header should render the shared activity badge');
  // Clicking the customer opens the Deal in a NEW tab — the tour stays open.
  assert.match(html, /target="_blank"/, 'the deal link must open in a new browser tab');
  // The History accordion must be present (collapsed by default).
  assert.match(html, /היסטוריה/, 'the History accordion must render');
  // Activity components section renders with both component names.
  assert.match(html, /מרכיבי הפעילות/, 'the activity-components section must render');
  assert.match(html, /סיור גרפיטי/, 'a non-workshop component renders');
  assert.match(html, /סדנת תקליטים/, 'a workshop component renders');
  assert.match(html, /סטודיו תל אביב/, 'the workshop component shows its location');
  // Cancellation now lives on the Deal — the tour modal must not expose it.
  assert.doesNotMatch(html, /בטל סיור/, 'the cancel-tour action must be removed');
  await unmount();
});

// The Tour timeline is a READ-ONLY event log. The shared TimelineFeed, when
// scoped to a tour_event, must NOT surface the Deal CRM composer (notes / tasks
// / email / WhatsApp / files) — that authoring belongs to the Deal. Mounting the
// shared component directly (not through the collapsed accordion) proves the
// history-only mode itself, which is where the guarantee lives.
test('Tour timeline (tour_event) renders history only — no Deal CRM composer', async () => {
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(TimelineFeed, { subjectType: 'tour_event', subjectId: 'tour1' }),
    ),
  );
  const html = container.innerHTML;
  // The history log itself must remain.
  assert.match(html, /היסטוריה/, 'the History section must still render for a tour');
  // None of the Deal composer tabs/controls may appear on a tour timeline.
  assert.doesNotMatch(html, /כתבו פתק/, 'the note composer must be absent');
  assert.doesNotMatch(html, /משימה/, 'the task tab must be absent');
  assert.doesNotMatch(html, /וואטסאפ/, 'the WhatsApp tab must be absent');
  assert.doesNotMatch(html, /אימייל/, 'the email tab must be absent');
  assert.doesNotMatch(html, /קובץ/, 'the file tab must be absent');
  assert.doesNotMatch(html, /בקרוב/, 'no "coming soon" composer placeholders may appear');
  await unmount();
});

// Conditional workshop-location UI (spec §7): a location control appears ONLY on
// workshop components — one independent control each. Mounting TourComponents
// directly lets us vary the rows precisely. `<select>` count == workshop count
// (the add affordance is a button, not a select, until clicked).
const AC = (id, nameHe, isWorkshop) => ({ id, nameHe, icon: '•', color: 'slate', isWorkshop, isActive: true });
const compRow = (id, comp, loc = null) => ({
  id,
  activityComponentId: comp.id,
  workshopLocationId: loc,
  sortOrder: 0,
  activityComponent: comp,
  workshopLocation: null,
});
const countSelects = (html) => (html.match(/<select/g) || []).length;

async function renderComponents(rows) {
  return render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(TourComponents, { tourId: 'tour1', rows, onChanged: () => {} }),
    ),
  );
}

test('no workshop component → no workshop-locations section at all', async () => {
  const { container, unmount } = await renderComponents([compRow('r1', AC('a', 'סיור גרפיטי', false))]);
  const html = container.innerHTML;
  assert.match(html, /סיור גרפיטי/);
  assert.doesNotMatch(html, /מיקומי סדנה/, 'the workshop-locations section must not render');
  assert.equal(countSelects(html), 0, 'no location <select> for a non-workshop component');
  await unmount();
});

test('one workshop component → locations section with exactly one selector, no warning', async () => {
  const { container, unmount } = await renderComponents([compRow('r1', AC('b', 'סדנת תקליטים', true))]);
  const html = container.innerHTML;
  assert.match(html, /מיקומי סדנה/, 'the workshop-locations section renders below the chips');
  assert.match(html, /בחירת מיקום סדנה/, 'an unset location shows a PLAIN placeholder (optional)');
  assert.doesNotMatch(html, /חסר מיקום סדנה/, 'no red missing-location warning — location is optional');
  assert.equal(countSelects(html), 1, 'exactly one location control for one workshop');
  await unmount();
});

test('two workshop components → two independent location controls', async () => {
  const { container, unmount } = await renderComponents([
    compRow('r1', AC('b', 'סדנת תקליטים', true)),
    compRow('r2', AC('c', 'סדנת ציור קיר', true)),
  ]);
  const html = container.innerHTML;
  assert.equal(countSelects(html), 2, 'each workshop gets its own location control');
  await unmount();
});

// Multi-select team add (Gmail-recipients style): the popover stays open, staff
// render as CHECKBOX rows, and one confirm button adds everyone at once.
test('team add popover offers multi-select staff with a single confirm button', async () => {
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(TourTeamEditor, { tourId: 'tour1', assignments: [], onChanged: () => {} }),
    ),
  );
  const plus = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '+');
  assert.ok(plus, 'the + trigger renders');
  await act(async () => {
    plus.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  const html = container.innerHTML;
  assert.match(html, /אבי כהן/, 'staff render in the popover');
  assert.match(html, /דור לוי/, 'all staff are listed at once');
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  assert.equal(checkboxes.length, 2, 'one checkbox per staff member');
  assert.match(html, /הוספת/, 'a single confirm button adds the selection');
  await unmount();
});

// Deal-side tour summary popover: shows LIVE staff / components / locations from
// the same TourEvent, with role colors intact. Opening it fetches api.tours.get
// (stubbed → TOUR_DETAIL). Proves the Deal reuses the same data + shared editor.
test('Deal tour popover shows live staff, components and locations', async () => {
  const booking = {
    tourEventId: 'tour1',
    tourEvent: { date: '2026-08-06', startTime: '17:00', status: 'scheduled' },
  };
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(DealTourSummary, { booking, onGroupSlot: true, canReplace: false }),
    ),
  );
  // Open the popover (click the banner trigger), then let the tour fetch resolve.
  const trigger = [...container.querySelectorAll('button')].find((b) =>
    /משובץ לסיור|סיור נוצר מהדיל/.test(b.textContent),
  );
  assert.ok(trigger, 'the banner trigger renders');
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  // The popover renders through the AnchoredMenu PORTAL on document.body (so the
  // right panel can never clip it) — assert against the body, not the container.
  const html = document.body.innerHTML;
  assert.match(html, /דנה מדריכה/, 'popover shows the assigned guide');
  assert.match(html, /מדריך ראשי/, 'popover shows the guide role');
  assert.match(html, /bg-emerald-100/, 'lead-guide role color is intact');
  assert.match(html, /סיור גרפיטי/, 'popover shows a component');
  assert.match(html, /סדנת תקליטים/, 'popover shows the workshop component');
  assert.match(html, /סטודיו תל אביב/, 'popover shows the workshop location');
  assert.match(html, /פתח סיור/, 'popover offers an open-tour action');
  assert.doesNotMatch(
    container.innerHTML,
    /פתח סיור/,
    'the popover must NOT render inline inside the panel (portal only)',
  );
  await unmount();
});

// Default components now belong to the VARIANT (not the Product). The variant
// editor renders its ordered selection; two variants of the same product carry
// their OWN sets (schema unique is per-variant), so different `initial` → different
// content. Mounted directly (the variant surface uses RichEditor elsewhere).
test('Variant default components render the variant-scoped ordered selection', async () => {
  const initial = [
    { activityComponentId: 'a', activityComponent: { id: 'a', nameHe: 'סיור גרפיטי', color: 'violet', isWorkshop: false, isActive: true } },
    { activityComponentId: 'b', activityComponent: { id: 'b', nameHe: 'סדנת תקליטים', color: 'blue', isWorkshop: true, isActive: true } },
  ];
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(VariantDefaultComponents, { variantId: 'v1', initial }),
    ),
  );
  const html = container.innerHTML;
  assert.match(html, /סיור גרפיטי/, 'renders the first default component');
  assert.match(html, /סדנת תקליטים/, 'renders the workshop default component');
  assert.match(html, /סדנה/, 'marks the workshop default');
  assert.match(html, /הוספת מרכיב/, 'offers an add control');
  await unmount();
});
