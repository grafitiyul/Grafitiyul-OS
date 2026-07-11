import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Guide Portal tour page smoke — the participant card renders through the
// SHARED ParticipantCardView (one presentation with the admin Tour modal):
//   * hierarchy: customer/contact → organization (· unit) → "👥 N משתתפים"
//     (the DTO ships title = organization-first; the card inverts it —
//     presentation only, the DTO contract is unchanged)
//   * "מידע חשוב על הלקוח" renders through RichText's TIGHT face
//     (gos-prose-tight — the display parity partner of the compact note
//     editor the field is authored in), not the full document rhythm
//   * the Deal order number ("דיל #NNNNN") is an internal CRM identifier and
//     admin-only — the DTO still ships orderNo by contract, the portal must
//     not render it

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'guide-tour-smoke');

// Guide detail DTO (guideTourDetailDto shape) — orderNo DELIBERATELY present.
const TOUR_DETAIL = {
  id: 'tour1', date: '2026-08-06', startTime: '17:00', durationHours: 3,
  status: 'scheduled', activityType: 'business', tourLanguage: 'he',
  variantName: 'סיור גרפיטי · תל אביב', productName: 'סיור גרפיטי',
  locationName: 'תל אביב', notes: null, viewerRole: 'lead_guide',
  participantsTotal: 25, team: [], components: [],
  participants: [{
    bookingId: 'bk1', status: 'active', seats: 25,
    title: 'אורט ישראל', customerName: 'רות לוי', organizationUnit: 'שכבת ט',
    orderNo: 27000,
    phone: '0501111111', email: null, fieldRepName: null,
    customerInfo: '<p>שימו לב: אלרגיה לבוטנים</p>', coordinationStatus: null,
  }],
};

let React;
let MemoryRouter;
let Routes;
let Route;
let Outlet;
let createRoot;
let act;
let GuideTourPage;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onResolve({ filter: /^emoji-picker-element/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
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
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.scrollTo = () => {};
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
    let body = {};
    if (u.includes('/tours/tour1/detail')) body = TOUR_DETAIL;
    else if (u.includes('/summary-status')) body = {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  GuideTourPage = await bundle(esbuild, './GuideTourPage.jsx');

  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ MemoryRouter, Routes, Route, Outlet } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
});

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await act(async () => {});
  return { container, unmount: () => act(async () => root.unmount()) };
}

// Layout route that supplies the portal Outlet context (token/person/permissions).
function PortalShell({ permissions }) {
  return React.createElement(Outlet, {
    context: {
      token: 'tok1',
      person: { displayName: 'דנה לוי' },
      permissions,
    },
  });
}

async function renderTourPage(permissions) {
  return render(
    React.createElement(MemoryRouter, { initialEntries: ['/p/tok1/tour/tour1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { element: React.createElement(PortalShell, { permissions }) },
          React.createElement(Route, { path: '/p/:token/tour/:tourEventId', element: React.createElement(GuideTourPage) })))),
  );
}

test('participant card: NO deal number — even when the DTO ships orderNo', async () => {
  const { container, unmount } = await renderTourPage({
    useCoordinationForms: true, fillTourSummary: false, useTourGallery: false,
    viewTeam: true,
  });
  const html = container.innerHTML;

  // The internal CRM identifier must be completely gone — no label, no number,
  // no empty placeholder span left behind.
  assert.doesNotMatch(html, /דיל/, 'the "דיל" label must not render in the portal');
  assert.doesNotMatch(html, /27000/, 'the order number must not render in the portal');

  // Hierarchy IN ORDER — identical to the admin card: customer name row,
  // organization (· unit) row, participants row. Three DISTINCT rows.
  const seatsRow = [...container.querySelectorAll('div')].find(
    (d) => d.textContent.trim() === '👥 25 משתתפים',
  );
  assert.ok(seatsRow, 'participants row renders');
  const rows = [...seatsRow.parentElement.children].map((el) => el.textContent.trim());
  assert.equal(rows.length, 3, 'identity block has exactly customer/org/participants rows');
  assert.equal(rows[0], 'רות לוי', 'row 1 is the customer name');
  assert.equal(rows[1], 'אורט ישראל · שכבת ט', 'row 2 is the organization (· unit)');
  assert.equal(rows[2], '👥 25 משתתפים');
  assert.match(html, /0501111111/);

  // "מידע חשוב על הלקוח" renders through the canonical TIGHT RichText face —
  // the same presentation as the admin card and the Deal page note view.
  assert.match(html, /מידע חשוב על הלקוח/);
  const info = container.querySelector('.gos-prose');
  assert.ok(info, 'customerInfo renders through RichText (.gos-prose)');
  assert.ok(
    info.className.includes('gos-prose-tight'),
    'customerInfo uses the tight note face, not the full document rhythm',
  );
  assert.match(info.innerHTML, /אלרגיה לבוטנים/);

  // Layout balance: the corner column still carries the coordination action.
  assert.match(html, /טופס שיחת תיאום/);
  await unmount();
});

test('participant card: coordination off → the corner column disappears entirely', async () => {
  const { container, unmount } = await renderTourPage({
    useCoordinationForms: false, fillTourSummary: false, useTourGallery: false,
    viewTeam: true,
  });
  const html = container.innerHTML;
  assert.doesNotMatch(html, /דיל|27000/);
  assert.doesNotMatch(html, /טופס שיחת תיאום/);
  // No empty corner container: the card header row has only the identity block.
  const header = [...container.querySelectorAll('div')].find(
    (d) => d.className.includes('items-start justify-between') && d.textContent.includes('אורט ישראל'),
  );
  assert.ok(header, 'participant card header renders');
  assert.equal(header.children.length, 1, 'only the identity block remains in the header row');
  await unmount();
});
