import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Deal-header "פתח דיל חדש לאותו איש קשר" smoke — RENDERS the real
// SameContactNewDealFlow (esbuild bundle, jsdom) and proves, against a
// recording fetch stub, that:
//   1. multiple linked contacts → chooser dialog with name/phone/email rows and
//      the primary contact visibly marked;
//   2. picking a contact continues into the canonical CreateDealModal in preset
//      mode (the picked contact fixed, no name/phone inputs);
//   3. a single linked contact skips the chooser — the modal opens directly
//      with the contact's primary organization preselected;
//   4. submitting creates ONE deal, links THE SELECTED contact as primary,
//      creates no new contact, and navigates to the new deal;
//   5. cancelling at either dialog writes nothing.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'same-contact-new-deal-smoke');

// Full contact payloads (GET /api/contacts/:id) — what the flow fetches before
// opening the modal. c1 carries a primary org link; c2 has none.
const CONTACT_1 = {
  id: 'c1',
  contactNo: 101,
  firstNameHe: 'ישראל',
  lastNameHe: 'ישראלי',
  firstNameEn: 'Israel',
  lastNameEn: 'Israeli',
  phones: [{ id: 'p1', value: '052-1111111', isPrimary: true }],
  emails: [{ id: 'e1', value: 'israel@example.com', isPrimary: true }],
  orgLinks: [
    { id: 'l1', isPrimary: true, organization: { id: 'o1', orgNo: 5, name: 'בית ספר אורט' }, organizationUnit: null },
  ],
};
const CONTACT_2 = {
  id: 'c2',
  contactNo: 102,
  firstNameHe: 'דנה',
  lastNameHe: 'כהן',
  firstNameEn: '',
  lastNameEn: '',
  phones: [{ id: 'p2', value: '052-2222222', isPrimary: true }],
  emails: [],
  orgLinks: [],
};

// Deal payloads as DealDetail holds them — DealContact rows with the compact
// CONTACT_SELECT contact (primary phone/email only, NO orgLinks).
function dealContactRow(id, contact, isPrimary) {
  return {
    id,
    contactId: contact.id,
    isPrimary,
    contact: {
      id: contact.id,
      contactNo: contact.contactNo,
      firstNameHe: contact.firstNameHe,
      lastNameHe: contact.lastNameHe,
      firstNameEn: contact.firstNameEn,
      lastNameEn: contact.lastNameEn,
      phones: contact.phones.slice(0, 1),
      emails: contact.emails.slice(0, 1),
    },
  };
}
const DEAL_ONE = { id: 'deal1', orderNo: 27500, contacts: [dealContactRow('dc1', CONTACT_1, true)] };
const DEAL_MANY = {
  id: 'deal2',
  orderNo: 27501,
  contacts: [dealContactRow('dc1', CONTACT_1, true), dealContactRow('dc2', CONTACT_2, false)],
};

let calls = [];

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let SameContactNewDealFlow;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

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
  if (typeof window.matchMedia === 'undefined') {
    const mm = (q) => ({
      matches: false, media: q,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
    window.matchMedia = mm;
    globalThis.matchMedia = mm;
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    let body = {};
    if (method === 'GET') {
      if (/\/api\/contacts\/c1$/.test(u)) body = CONTACT_1;
      else if (/\/api\/contacts\/c2$/.test(u)) body = CONTACT_2;
      else if (u.includes('/api/organization-types')) body = [{ id: 't1', label: 'בית ספר', sortOrder: 1 }];
      else if (u.includes('/api/organization-subtypes')) body = [];
      else if (u.includes('/api/deal-sources')) body = [{ id: 'src1', label: 'אתר', active: true, sortOrder: 1 }];
      else if (/\/api\/organizations\/o1/.test(u)) body = { id: 'o1', name: 'בית ספר אורט', organizationType: { id: 't1', label: 'בית ספר' }, units: [] };
      else if (u.includes('/api/organizations')) body = [];
    } else if (method === 'POST') {
      if (u.endsWith('/api/deals')) body = { id: 'd9', orderNo: 27999, title: 'ישראל ישראלי', status: 'open' };
      else body = { ok: true };
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'sameContactNewDealFlow.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'SameContactNewDealFlow.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  SameContactNewDealFlow = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

// Stateful host: open starts true; onClose flips it false (like DealDetail).
function Harness({ deal }) {
  const [open, setOpen] = React.useState(true);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('div', null, open ? 'FLOW_OPEN' : 'FLOW_CLOSED'),
    React.createElement(SameContactNewDealFlow, { deal, open, onClose: () => setOpen(false) }),
  );
}

async function render(deal) {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  const el = React.createElement(
    MemoryRouter,
    { initialEntries: ['/host'] },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, { path: '/host', element: React.createElement(Harness, { deal }) }),
      // Probe: successful creation must navigate to the NEW deal's page.
      React.createElement(Route, {
        path: '/admin/crm/deals/:orderNo',
        element: React.createElement('div', null, 'DEAL_PAGE_PROBE'),
      }),
    ),
  );
  await act(async () => root.render(el));
  await act(async () => {}); // flush effects/fetches
  return {
    // Dialog portals onto <body>, so the assertion scope is the document —
    // not the mount root the component was rendered into.
    container: document.body,
    unmount: async () => {
      await act(async () => root.unmount());
      mountRoot.remove();
    },
  };
}

function findButton(container, text) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));
}

test('multiple contacts → chooser with name/phone/email rows, primary marked; pick → canonical modal', async () => {
  calls = [];
  const { container, unmount } = await render(DEAL_MANY);

  // The chooser (not the create modal) opens first.
  assert.match(container.innerHTML, /בחירת איש קשר/);
  assert.doesNotMatch(container.innerHTML, /לא ייווצר איש קשר חדש/);

  // Both linked contacts render with their details; the primary one is marked.
  assert.match(container.innerHTML, /ישראל ישראלי/);
  assert.match(container.innerHTML, /052-1111111/);
  assert.match(container.innerHTML, /israel@example\.com/);
  assert.match(container.innerHTML, /דנה כהן/);
  assert.match(container.innerHTML, /052-2222222/);
  assert.match(container.innerHTML, /ראשי/, 'primary contact carries a visible ראשי badge');

  // Pick the NON-primary contact → its FULL payload is fetched → preset modal.
  const row = findButton(container, 'דנה כהן');
  assert.ok(row, 'the second contact renders as a selectable row');
  await act(async () => row.click());
  await act(async () => {});
  assert.ok(
    calls.some((c) => c.method === 'GET' && /\/api\/contacts\/c2$/.test(c.url)),
    'the picked contact is fetched in full before the modal opens',
  );
  assert.match(container.innerHTML, /לא ייווצר איש קשר חדש/, 'canonical preset mode');
  assert.match(container.innerHTML, /דנה כהן/, 'the PICKED contact is the preset');
  const nameInput = [...container.querySelectorAll('input')].find((i) => i.placeholder === 'לדוגמה: ישראל ישראלי');
  assert.equal(nameInput, undefined, 'no full-name input — the contact is fixed');

  const writes = calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(writes, [], 'nothing is written before the final create');
  await unmount();
});

test('cancel at the chooser writes nothing and closes the flow', async () => {
  calls = [];
  const { container, unmount } = await render(DEAL_MANY);
  await act(async () => findButton(container, 'ביטול').click());
  assert.doesNotMatch(container.innerHTML, /בחירת איש קשר/);
  assert.match(container.innerHTML, /FLOW_CLOSED/);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [], 'zero writes');
  await unmount();
});

test('single contact → straight into the canonical modal with the org preselected', async () => {
  calls = [];
  const { container, unmount } = await render(DEAL_ONE);

  assert.doesNotMatch(container.innerHTML, /בחירת איש קשר/, 'no chooser for a single contact');
  assert.match(container.innerHTML, /לא ייווצר איש קשר חדש/, 'preset modal opened directly');
  assert.match(container.innerHTML, /ישראל ישראלי/);
  const orgInput = [...container.querySelectorAll('input')].find((i) => i.value === 'בית ספר אורט');
  assert.ok(orgInput, "the contact's primary organization is preselected");

  // Cancel → close, zero writes.
  await act(async () => findButton(container, 'ביטול').click());
  assert.match(container.innerHTML, /FLOW_CLOSED/);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [], 'cancel creates nothing');
  await unmount();
});

test('submit creates ONE deal for the selected contact (no new contact) and navigates to it', async () => {
  calls = [];
  const { container, unmount } = await render(DEAL_ONE);

  // Pick the source (the only remaining required field) and submit.
  const select = [...container.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'src1'),
  );
  assert.ok(select, 'source select exists');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'src1');
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const submit = findButton(container, 'צור דיל');
  assert.equal(submit.disabled, false, 'submit enabled once a source is picked');
  await act(async () => submit.click());
  await act(async () => {});

  const writes = calls.filter((c) => c.method !== 'GET');
  assert.equal(writes.filter((c) => c.url.endsWith('/api/contacts')).length, 0, 'NO new contact is created');
  const dealCreates = writes.filter((c) => c.url.endsWith('/api/deals'));
  assert.equal(dealCreates.length, 1, 'exactly one deal is created');
  assert.equal(dealCreates[0].body.organizationId, 'o1', "the contact's org is linked");
  const links = writes.filter((c) => /\/api\/deals\/d9\/contacts$/.test(c.url));
  assert.equal(links.length, 1, 'the deal is linked to a contact exactly once');
  assert.deepEqual(links[0].body, { contactId: 'c1', isPrimary: true }, 'THE SELECTED contact, as primary');

  assert.match(container.innerHTML, /DEAL_PAGE_PROBE/, 'navigated to the new deal page');
  await unmount();
});
