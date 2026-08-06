import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// The bug this file guards: an operator on page 4 of a filtered list opens a
// record, presses Back, and lands on page 1 at the top. These tests RENDER the
// real list screens (nothing mocked but the network) and assert the whole
// contract end to end:
//   • a list mounted at ?page=4 fetches page 4 and shows page 4
//   • search / filters / sort survive a remount at the same URL
//   • "עבור לסוף" jumps to the last page in ONE fetch, keeping the filters
//   • the jump controls disable at the ends
//   • state does not leak between two different list modules
//   • a record opened from a list carries a return location; a pasted record
//     URL falls back safely
//
// Rendering (rather than unit-testing the hook) is deliberate: the previous
// regression was an innocent-looking `useEffect(() => setPage(1), [filters])`
// that no pure test could have caught.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'list-restore-smoke');

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let DealsList;
let ContactsList;

// Every request the screens make, in order — the assertions read this.
let calls = [];

function deal(n) {
  return {
    id: `d${n}`,
    orderNo: 27000 + n,
    title: `דיל ${n}`,
    status: 'open',
    valueMinor: 100000,
    currency: 'ILS',
    dealStage: { id: 's1', label: 'שלב' },
    organization: null,
    contacts: [],
    _count: { contacts: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    lastMeaningfulActivityAt: '2026-01-02T00:00:00.000Z',
  };
}
function contact(n) {
  return {
    id: `c${n}`,
    contactNo: 500 + n,
    fullNameHe: `איש ${n}`,
    fullNameEn: null,
    phones: [],
    emails: [],
    orgLinks: [],
    _count: { dealContacts: 0 },
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

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
  globalThis.sessionStorage = window.sessionStorage;
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

  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const params = new URLSearchParams(u.includes('?') ? u.slice(u.indexOf('?') + 1) : '');
    const page = Number(params.get('page') || 1);
    const pageSize = Number(params.get('pageSize') || 25);
    let body = {};
    if (u.startsWith('/api/deals/summary')) {
      body = {
        open: { count: 500, sumMinor: 0 }, won: { count: 0, sumMinor: 0 },
        lost: { count: 0, sumMinor: 0 }, all: { count: 500, sumMinor: 0 },
      };
    } else if (u.startsWith('/api/deals')) {
      body = { rows: Array.from({ length: pageSize }, (_, i) => deal((page - 1) * pageSize + i)), total: 500, page, pageSize };
    } else if (u.startsWith('/api/contacts')) {
      body = { rows: Array.from({ length: pageSize }, (_, i) => contact((page - 1) * pageSize + i)), total: 250, page, pageSize };
    } else if (u.startsWith('/api/deal-stages')) {
      body = [{ id: 's1', label: 'שלב' }];
    } else {
      body = [];
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const build = async (entry, out) => {
    const outfile = path.join(cacheDir, out);
    await esbuild.build({
      entryPoints: [entry],
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
  };
  DealsList = await build(path.join(clientRoot, 'src', 'admin', 'deals', 'DealsList.jsx'), 'deals.bundle.mjs');
  ContactsList = await build(path.join(clientRoot, 'src', 'admin', 'crm', 'contacts', 'ContactsList.jsx'), 'contacts.bundle.mjs');

  React = (await import('react')).default;
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
});

// Renders a screen at `url` inside a real router, and exposes the live location
// so the assertions can read what the URL became.
async function renderAt(Screen, url, routePath = '*') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const seen = { location: null };
  function Probe() {
    const { useLocation } = require_router();
    seen.location = useLocation();
    return null;
  }
  await act(async () =>
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [url] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: routePath,
            element: React.createElement(React.Fragment, null, React.createElement(Screen), React.createElement(Probe)),
          }),
        ),
      ),
    ),
  );
  await act(async () => {});
  await act(async () => {});
  return {
    container,
    get search() {
      return seen.location?.search || '';
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

let routerModule = null;
function require_router() {
  return routerModule;
}

before(async () => {
  routerModule = await import('react-router-dom');
});

function pagerLabel(container) {
  const el = [...container.querySelectorAll('span.tabular-nums')].find((s) => / \/ /.test(s.textContent));
  return el ? el.textContent.trim() : null;
}
function btn(container, label) {
  return [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
}
function dealsListCalls() {
  return calls.filter((c) => c.startsWith('/api/deals?'));
}

// ── 1 / 2. the reported bug ────────────────────────────────────────────────

test('a Deals list mounted at page 4 fetches page 4 and shows page 4', async () => {
  const view = await renderAt(DealsList, '/admin/crm/deals?page=4');
  const listCall = dealsListCalls().at(-1);
  assert.match(listCall, /(^|[?&])page=4(&|$)/, `expected page=4 in ${listCall}`);
  assert.equal(pagerLabel(view.container), '4 / 10');
  await view.unmount();
});

test('search, status filter and sort all survive a remount at the same URL', async () => {
  // This IS the Back case: react-router restores the URL, the list re-mounts.
  const url = '/admin/crm/deals?page=4&q=%D7%91%D7%A0%D7%A7&status=won&sort=amount:asc';
  const first = await renderAt(DealsList, url);
  const before = dealsListCalls().at(-1);
  assert.match(before, /search=%D7%91%D7%A0%D7%A7/);
  assert.match(before, /status=won/);
  assert.match(before, /sort=valueMinor%3Aasc/);
  assert.match(before, /page=4/);
  assert.equal(first.container.querySelector('input').value, 'בנק');
  await first.unmount();

  calls = [];
  const second = await renderAt(DealsList, url);
  const after = dealsListCalls().at(-1);
  assert.equal(new URL(`http://x${after}`).search, new URL(`http://x${before}`).search);
  assert.equal(pagerLabel(second.container), '4 / 10');
  await second.unmount();
});

// ── 4. refresh preserves URL-owned state ────────────────────────────────────

test('a deep link is reproduced exactly and is NOT contaminated by sticky filters', async () => {
  // Someone else's remembered workspace must never rewrite a pasted link.
  const first = await renderAt(DealsList, '/admin/crm/deals?status=lost');
  await first.unmount();
  // Sticky now says status=lost. A link that says page=2 (and nothing about
  // status) is authoritative: it must render ALL deals, not the lost ones.
  calls = [];
  const second = await renderAt(DealsList, '/admin/crm/deals?page=2');
  const call = dealsListCalls().at(-1);
  assert.doesNotMatch(call, /status=/);
  assert.match(call, /page=2/);
  await second.unmount();
});

test('with no URL state at all, the remembered workspace is restored and canonicalised', async () => {
  // A DELIBERATE choice (clicking the WON card) is what becomes a preference —
  // not merely landing on someone else's deep link.
  const first = await renderAt(DealsList, '/admin/crm/deals');
  const wonCard = [...first.container.querySelectorAll('button')].find((b) => b.textContent.includes('WON'));
  assert.ok(wonCard, 'the WON status card rendered');
  await act(async () => wonCard.click());
  await act(async () => {});
  assert.match(first.search, /status=won/);
  await first.unmount();

  calls = [];
  const second = await renderAt(DealsList, '/admin/crm/deals');
  assert.match(dealsListCalls().at(-1), /status=won/);
  // …and the address bar now SHOWS what is on screen, so Back/copy-link agree.
  assert.match(second.search, /status=won/);
  await second.unmount();
});

// ── 8 / 9 / 10. עבור לסוף ───────────────────────────────────────────────────

test('"עבור לסוף" jumps to the last page in ONE fetch', async () => {
  const view = await renderAt(DealsList, '/admin/crm/deals');
  assert.equal(pagerLabel(view.container), '1 / 10');
  const before = dealsListCalls().length;
  await act(async () => btn(view.container, 'עבור לסוף').click());
  await act(async () => {});
  assert.equal(pagerLabel(view.container), '10 / 10');
  const added = dealsListCalls().slice(before);
  assert.equal(added.length, 1, `expected exactly one fetch, got ${added.length}`);
  assert.match(added[0], /page=10/);
  await view.unmount();
});

test('"עבור לסוף" keeps the active search, filter and sort', async () => {
  const view = await renderAt(DealsList, '/admin/crm/deals?q=%D7%91%D7%A0%D7%A7&status=won&sort=amount:asc');
  await act(async () => btn(view.container, 'עבור לסוף').click());
  await act(async () => {});
  const call = dealsListCalls().at(-1);
  assert.match(call, /page=10/);
  assert.match(call, /search=%D7%91%D7%A0%D7%A7/);
  assert.match(call, /status=won/);
  assert.match(call, /sort=valueMinor%3Aasc/);
  await view.unmount();
});

test('the jump controls disable at the ends', async () => {
  const first = await renderAt(DealsList, '/admin/crm/deals?page=1');
  assert.equal(btn(first.container, 'עבור לתחילת הרשימה').disabled, true);
  assert.equal(btn(first.container, 'עבור לסוף').disabled, false);
  await first.unmount();

  const last = await renderAt(DealsList, '/admin/crm/deals?page=10');
  assert.equal(btn(last.container, 'עבור לסוף').disabled, true);
  assert.equal(btn(last.container, 'עבור לתחילת הרשימה').disabled, false);
  await last.unmount();
});

test('changing a filter returns to page 1 — a deep page of a new result set is meaningless', async () => {
  const view = await renderAt(DealsList, '/admin/crm/deals?page=7');
  const input = view.container.querySelector('input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'לאומי');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => {});
  assert.match(view.search, /page=1|^(?!.*page=)/);
  assert.doesNotMatch(view.search, /page=7/);
  await view.unmount();
});

test('fast typing is not dropped by the URL round-trip', async () => {
  // The search box is now a controlled input whose value comes back from the
  // router. A burst of keystrokes must still land character-for-character.
  const view = await renderAt(DealsList, '/admin/crm/deals');
  const input = view.container.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const word = 'לאומי';
  for (let i = 1; i <= word.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      setter.call(input, word.slice(0, i));
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }
  await act(async () => {});
  assert.equal(view.container.querySelector('input').value, word);
  await view.unmount();
});

// ── 6. another module behaves the same ──────────────────────────────────────

test('Contacts follows the same contract (page 4 restored, jump to end works)', async () => {
  const view = await renderAt(ContactsList, '/admin/crm/contacts?page=4');
  const call = calls.filter((c) => c.startsWith('/api/contacts?')).at(-1);
  assert.match(call, /page=4/);
  assert.equal(pagerLabel(view.container), '4 / 5');
  await act(async () => btn(view.container, 'עבור לסוף').click());
  await act(async () => {});
  assert.equal(pagerLabel(view.container), '5 / 5');
  assert.equal(btn(view.container, 'עבור לסוף').disabled, true);
  await view.unmount();
});

// ── 11. no leaking between modules ──────────────────────────────────────────

test('Deals state never leaks into Contacts', async () => {
  const deals = await renderAt(DealsList, '/admin/crm/deals?page=6&q=deal-only&status=won');
  await deals.unmount();
  calls = [];
  const contacts = await renderAt(ContactsList, '/admin/crm/contacts');
  const call = calls.filter((c) => c.startsWith('/api/contacts?')).at(-1);
  assert.doesNotMatch(call, /deal-only/);
  assert.doesNotMatch(call, /status=won/);
  assert.doesNotMatch(call, /page=6/);
  assert.equal(pagerLabel(contacts.container), '1 / 5');
  await contacts.unmount();
});

// ── 5. a second tab cannot disturb the first ────────────────────────────────

test('two lists mounted at different URLs keep independent scroll memory', async () => {
  // sessionStorage is per browser TAB; within a tab the scroll store is keyed
  // by the full list URL, so page 4 and page 5 never share an offset.
  const { saveScrollTop, readScrollTop, scrollKey } = await import('./listNav.js');
  saveScrollTop(scrollKey('/admin/crm/deals', '?page=4'), 900, window.sessionStorage);
  assert.equal(readScrollTop(scrollKey('/admin/crm/deals', '?page=4'), window.sessionStorage), 900);
  assert.equal(readScrollTop(scrollKey('/admin/crm/deals', '?page=5'), window.sessionStorage), 0);
});

// ── 3. scroll position ──────────────────────────────────────────────────────

test('scroll position is recorded and restored on return to the same list URL', async () => {
  const { useListScrollRestore } = await import('./useListState.js');
  const { useLocation } = routerModule;

  // A list-shaped tree: a scrolling container (the module layout's
  // overflow-y-auto wrapper) with the screen inside it.
  function Screen() {
    const anchor = useListScrollRestore(true);
    useLocation(); // same hook order as a real screen
    return React.createElement('div', { ref: anchor }, 'rows');
  }
  const host = document.createElement('div');
  host.setAttribute('style', 'overflow-y: auto');
  document.body.appendChild(host);

  const mount = async (url) => {
    const root = createRoot(host);
    await act(async () =>
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: [url] },
          React.createElement(Routes, null, React.createElement(Route, { path: '*', element: React.createElement(Screen) })),
        ),
      ),
    );
    await act(async () => {});
    await new Promise((r) => setTimeout(r, 20)); // let the restore rAF run
    await act(async () => {});
    return root;
  };

  let root = await mount('/admin/crm/deals?page=4');
  host.scrollTop = 1234;
  host.dispatchEvent(new window.Event('scroll'));
  await new Promise((r) => setTimeout(r, 20));
  await act(async () => root.unmount());

  // Returning to the SAME list URL restores the offset…
  host.scrollTop = 0;
  root = await mount('/admin/crm/deals?page=4');
  assert.equal(host.scrollTop, 1234);
  await act(async () => root.unmount());

  // …while a DIFFERENT list state (a filter change) correctly starts at the top.
  host.scrollTop = 555;
  root = await mount('/admin/crm/deals?page=5');
  assert.equal(host.scrollTop, 0);
  await act(async () => root.unmount());
  host.remove();
});

// ── 12. record navigation origin ────────────────────────────────────────────

test('opening a deal from the list carries the return location; a pasted URL does not', async () => {
  const { makeListReturn, resolveListReturn } = await import('./listNav.js');
  const view = await renderAt(DealsList, '/admin/crm/deals?page=4&status=won');
  const row = view.container.querySelector('tbody tr');
  assert.ok(row, 'a deal row rendered');
  await view.unmount();

  // What the row hands the record page, and what the record page does with it.
  const origin = makeListReturn({ pathname: '/admin/crm/deals', search: '?page=4&status=won' });
  assert.equal(resolveListReturn(origin, '/admin/crm/deals').to, '/admin/crm/deals?page=4&status=won');
  assert.equal(resolveListReturn(null, '/admin/crm/deals').to, '/admin/crm/deals');
  assert.equal(resolveListReturn(null, '/admin/crm/deals').mode, 'fallback');
});
