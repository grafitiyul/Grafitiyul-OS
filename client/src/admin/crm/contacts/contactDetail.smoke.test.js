import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Contact workspace smoke — the "פתיחת דיל חדש" flow. RENDERS the real
// ContactDetail (esbuild bundle, jsdom) and proves, against a recording fetch
// stub, that:
//   1. the prominent create-deal button exists in the header;
//   2. clicking it opens the canonical CreateDealModal in preset mode — the
//      current contact shown read-only, its linked org preselected;
//   3. submitting creates the deal + links THIS contact (no new contact is
//      created — zero POST /api/contacts) and navigates to the new deal;
//   4. cancelling leaves everything unchanged (no POSTs at all).
// The TimelineFeed is stubbed out — it is not under test here.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'contact-detail-smoke');

const CONTACT = {
  id: 'c1',
  contactNo: 123,
  firstNameHe: 'ישראל',
  lastNameHe: 'ישראלי',
  firstNameEn: 'Israel',
  lastNameEn: 'Israeli',
  notes: '',
  phones: [],
  emails: [],
  orgLinks: [
    {
      id: 'l1',
      isPrimary: true,
      organization: { id: 'o1', orgNo: 5, name: 'בית ספר אורט' },
      organizationUnit: null,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let calls = [];

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let ContactDetail;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

// The timeline feed drags in the whole rich-text stack — irrelevant to this
// smoke and fragile under jsdom. Stub it to a null component.
const timelineStubPlugin = {
  name: 'timeline-stub',
  setup(build) {
    build.onResolve({ filter: /TimelineFeed\.jsx$/ }, () => ({ path: 'timeline-feed', namespace: 'component-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'component-stub' }, () => ({
      contents: 'export default function TimelineFeedStub() { return null; }',
      loader: 'js',
    }));
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
      if (/\/api\/contacts\/[^/]+\/files/.test(u)) body = [];
      else if (/\/api\/contacts\/[^/]+\/reservation-link/.test(u)) body = { eligible: false, link: null };
      else if (/\/api\/contacts\/[^/]+/.test(u)) body = CONTACT;
      else if (u.includes('/api/timeline/aggregate')) body = [];
      else if (u.includes('/api/legacy-card')) body = { records: [] };
      else if (u.includes('/api/organization-types')) body = [{ id: 't1', label: 'בית ספר', sortOrder: 1 }];
      else if (u.includes('/api/organization-subtypes')) body = [];
      else if (u.includes('/api/deal-sources')) body = [{ id: 'src1', label: 'אתר', active: true, sortOrder: 1 }];
      else if (/\/api\/organizations\/o1/.test(u)) body = { id: 'o1', name: 'בית ספר אורט', organizationType: { id: 't1', label: 'בית ספר' }, units: [] };
      else if (u.includes('/api/organizations')) body = [];
    } else if (method === 'POST') {
      if (u.endsWith('/api/deals')) body = { id: 'd1', orderNo: 27001, title: 'ישראל ישראלי', status: 'open' };
      else if (/\/api\/deals\/d1\/contacts/.test(u)) body = { ok: true };
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
  const outfile = path.join(cacheDir, 'contactDetail.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'ContactDetail.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin, timelineStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  ContactDetail = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const el = React.createElement(
    MemoryRouter,
    { initialEntries: ['/admin/crm/contacts/123'] },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: '/admin/crm/contacts/:id',
        element: React.createElement(ContactDetail),
      }),
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
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function findButton(container, text) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));
}

test('header shows the prominent create-deal button; opening + cancel change nothing', async () => {
  calls = [];
  const { container, unmount } = await render();

  const btn = findButton(container, 'פתיחת דיל חדש');
  assert.ok(btn, 'the "פתיחת דיל חדש" button exists on the contact page');

  await act(async () => btn.click());
  // Preset mode: the current contact shown read-only, no name/phone inputs,
  // and the linked org preselected in the picker.
  assert.match(container.innerHTML, /לא ייווצר איש קשר חדש/);
  assert.match(container.innerHTML, /דיל חדש/);
  const orgInput = [...container.querySelectorAll('input')].find((i) => i.value === 'בית ספר אורט');
  assert.ok(orgInput, 'the contact\'s linked organization is preselected');
  const nameInput = [...container.querySelectorAll('input')].find((i) => i.placeholder === 'לדוגמה: ישראל ישראלי');
  assert.equal(nameInput, undefined, 'no full-name input — the contact is fixed');

  // Cancel → modal closes, nothing was written.
  const cancel = findButton(container, 'ביטול');
  assert.ok(cancel, 'cancel button exists');
  await act(async () => cancel.click());
  assert.doesNotMatch(container.innerHTML, /לא ייווצר איש קשר חדש/);
  const writes = calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(writes, [], 'cancel leaves everything unchanged');
  await unmount();
});

test('submit creates the deal for THIS contact (no duplicate) and navigates to it', async () => {
  calls = [];
  const { container, unmount } = await render();

  await act(async () => findButton(container, 'פתיחת דיל חדש').click());

  // Title auto-derived from the contact name.
  const titleInput = [...container.querySelectorAll('input')].find((i) => i.value === 'ישראל ישראלי');
  assert.ok(titleInput, 'deal title auto-derived from the contact name');

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
  assert.ok(submit, 'submit button exists');
  assert.equal(submit.disabled, false, 'submit enabled once a source is picked');
  await act(async () => submit.click());
  await act(async () => {});

  const writes = calls.filter((c) => c.method !== 'GET');
  const contactCreates = writes.filter((c) => c.url.endsWith('/api/contacts'));
  assert.equal(contactCreates.length, 0, 'NO new contact is created');

  const dealCreates = writes.filter((c) => c.url.endsWith('/api/deals'));
  assert.equal(dealCreates.length, 1, 'exactly one deal is created');
  assert.equal(dealCreates[0].body.title, 'ישראל ישראלי');
  assert.equal(dealCreates[0].body.activityType, 'business', 'linked org → business deal');
  assert.equal(dealCreates[0].body.organizationId, 'o1', 'the contact\'s org is linked');

  const links = writes.filter((c) => /\/api\/deals\/d1\/contacts$/.test(c.url));
  assert.equal(links.length, 1, 'the deal is linked to a contact exactly once');
  assert.deepEqual(links[0].body, { contactId: 'c1', isPrimary: true }, 'linked to THE CURRENT contact as primary');

  assert.match(container.innerHTML, /DEAL_PAGE_PROBE/, 'navigated to the new deal page');
  await unmount();
});
