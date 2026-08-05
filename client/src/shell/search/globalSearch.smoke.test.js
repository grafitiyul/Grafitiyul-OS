import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Global-search smoke — recent searches + the "+ ליד" no-result action.
// RENDERS the real GlobalSearch (esbuild bundle, jsdom) against a recording
// fetch stub and proves:
//   1. focusing the EMPTY field shows recent searches (most recent first);
//   2. clicking a recent search runs that query again;
//   3. keyboard: Enter on the highlighted recent re-runs it;
//   4. clear-one and clear-all work;
//   5. a zero-result search shows "+ ליד" ONLY after the cross-category
//      verification completes — never while loading;
//   6. "+ ליד" opens the canonical CreateDealModal with the classified field
//      prefilled, and NOTHING is written before submit (zero POSTs);
//   7. cancelling the modal leaves everything unchanged;
//   8. a search WITH results never shows "+ ליד";
//   9. the committed search lands in the per-operator recent history.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'global-search-smoke');

const RECENTS_KEY = 'gos.globalSearch.recents.v1:local';

let calls = [];
// Queries whose /api/search response is held open until release() — lets the
// test assert what the UI shows WHILE a search is still loading.
let held = null; // { q, resolvers: [] }

const CONTACT_RESULT = {
  type: 'contact',
  id: 'c1',
  path: '/admin/crm/contacts/1',
  fullNameHe: 'דנה כהן',
  fullNameEn: '',
  phone: '0501234567',
  email: '',
  dealCount: 0,
  recentDeals: [],
  reasons: [],
};

function searchResponse(q) {
  // 'דנה כהן' and the existing phone have hits; everything else is empty.
  if (q === 'דנה כהן' || q === '0501234567') {
    return {
      groups: [
        { category: 'contacts', label: 'אנשי קשר', total: 1, truncated: false, results: [CONTACT_RESULT] },
      ],
      truncated: false,
    };
  }
  return { groups: [], truncated: false };
}

let React;
let MemoryRouter;
let createRoot;
let act;
let GlobalSearch;

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    let body = {};
    if (method === 'GET') {
      if (u.includes('/api/search')) {
        const params = new URL(u, 'http://localhost').searchParams;
        const q = params.get('q') || '';
        const category = params.get('category') || '';
        if (held && held.q === q && category !== 'all') {
          await new Promise((resolve) => held.resolvers.push(resolve));
        }
        body = searchResponse(q);
      } else if (u.includes('/api/organization-types')) body = [{ id: 't1', label: 'בית ספר', sortOrder: 1 }];
      else if (u.includes('/api/organization-subtypes')) body = [];
      else if (u.includes('/api/deal-sources')) body = [{ id: 'src1', label: 'אתר', active: true, sortOrder: 1 }];
    } else if (method === 'POST') {
      body = { ok: true };
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'globalSearch.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'GlobalSearch.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  GlobalSearch = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  calls = [];
  held = null;
  window.localStorage.clear();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedRecents(items) {
  window.localStorage.setItem(
    RECENTS_KEY,
    JSON.stringify({ v: 1, items: items.map((q, i) => ({ q, kind: 'name_he', at: 1000 - i })) }),
  );
}

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const el = React.createElement(
    MemoryRouter,
    { initialEntries: ['/admin'] },
    React.createElement(GlobalSearch),
  );
  await act(async () => root.render(el));
  await act(async () => {});
  return {
    container,
    input: container.querySelector('input[type="text"]'),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  // Debounce (250ms) + response flush.
  await act(async () => { await sleep(320); });
}

async function focus(input) {
  await act(async () => { input.focus(); });
}

function keydown(input, key) {
  return act(async () => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function mousedown(el) {
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

function rows(container) {
  return [...container.querySelectorAll('[role="option"]')];
}

test('focusing the empty field shows recent searches, most recent first', async () => {
  seedRecents(['0501234567', 'דנה כהן']);
  const { container, input, unmount } = await render();

  await focus(input);
  const options = rows(container);
  assert.equal(options.length, 2);
  assert.match(options[0].textContent, /0501234567/);
  assert.match(options[1].textContent, /דנה כהן/);
  assert.ok(container.textContent.includes('חיפושים אחרונים'));
  await unmount();
});

test('clicking a recent search reruns it IMMEDIATELY — no debounce gap, no refocus', async () => {
  seedRecents(['דנה כהן']);
  const { container, input, unmount } = await render();

  await focus(input);
  await mousedown(rows(container)[0]);
  assert.equal(input.value, 'דנה כהן');

  // Immediately after the click — with NO debounce wait and NO further
  // interaction — the search has fired and the panel is still mounted,
  // showing loading or the results (never closed, never the recents rows).
  const immediateSearch = calls.filter(
    (c) => c.url.includes('/api/search') && decodeURIComponent(c.url).includes('q=דנה כהן'),
  );
  assert.ok(immediateSearch.length >= 1, 'the search fired without waiting for the debounce');
  assert.ok(!container.textContent.includes('חיפושים אחרונים'), 'history rows are replaced');
  assert.ok(
    container.textContent.includes('מחפש…') || rows(container).some((r) => r.textContent.includes('דנה כהן')),
    'panel stays open with loading or results',
  );

  // After the response settles: the normal rich result rows, same components
  // as a typed search — clickable right away.
  await act(async () => { await sleep(50); });
  const resultRow = rows(container).find((r) => r.textContent.includes('דנה כהן'));
  assert.ok(resultRow, 'rich result row rendered without any extra interaction');
  await mousedown(resultRow);
  // Selecting it records the reused query back at the top of the history.
  const stored = JSON.parse(window.localStorage.getItem(RECENTS_KEY));
  assert.equal(stored.items[0].q, 'דנה כהן');
  await unmount();
});

test('a mousedown whose target our own re-render detached is NOT an outside click', async () => {
  seedRecents(['דנה כהן', 'יוסי לוי']);
  const { container, input, unmount } = await render();
  await focus(input);

  // Simulate the real-browser ordering: React flushed the recent-click update
  // synchronously, so by the time the document-level listener sees the same
  // mousedown its target is already detached from the DOM.
  const detached = document.createElement('div');
  const ev = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'target', { value: detached });
  await act(async () => { document.dispatchEvent(ev); });

  assert.ok(
    container.textContent.includes('חיפושים אחרונים'),
    'panel stayed open — a detached-target mousedown never dismisses it',
  );
  await unmount();
});

test('keyboard: Enter on the highlighted recent re-runs it and shows rich results', async () => {
  seedRecents(['0501234567', 'דנה כהן']);
  const { container, input, unmount } = await render();

  await focus(input);
  await keydown(input, 'Enter'); // first row is highlighted by default
  assert.equal(input.value, '0501234567');
  await act(async () => { await sleep(50); }); // no debounce needed
  assert.ok(
    rows(container).some((r) => r.textContent.includes('דנה כהן')),
    'result rows rendered straight after Enter',
  );
  await unmount();
});

test('clear one recent and clear all', async () => {
  seedRecents(['0501234567', 'דנה כהן']);
  const { container, input, unmount } = await render();

  await focus(input);
  // Remove the first row via its ✕.
  const removeBtn = rows(container)[0].querySelector('button');
  await mousedown(removeBtn);
  let options = rows(container);
  assert.equal(options.length, 1);
  assert.match(options[0].textContent, /דנה כהן/);

  // Clear all.
  const clearAll = [...container.querySelectorAll('button')].find((b) => b.textContent === 'נקה הכל');
  await mousedown(clearAll);
  assert.equal(rows(container).length, 0);
  assert.equal(window.localStorage.getItem(RECENTS_KEY), null);
  await unmount();
});

test('"+ ליד" appears only AFTER a zero-result search completes — never while loading', async () => {
  const { container, input, unmount } = await render();

  held = { q: '0587654321', resolvers: [] };
  await type(input, '0587654321');
  // The search is still in flight — no create action, no empty-state.
  assert.ok(!container.textContent.includes('+ ליד'), 'no create action while loading');

  // Release the response; the cross-category check then completes too.
  await act(async () => {
    held.resolvers.forEach((r) => r());
    held = null;
    await sleep(20);
  });
  assert.ok(container.textContent.includes('אין תוצאות'));
  assert.ok(container.textContent.includes('+ ליד'), 'create action after confirmed zero results');
  assert.match(container.textContent, /0587654321/);
  // The cross-category verification actually ran.
  assert.ok(
    calls.some((c) => c.url.includes('/api/search') && c.url.includes('category=all')),
    'zero results were verified across all categories',
  );
  await unmount();
});

test('a search WITH results never offers "+ ליד"', async () => {
  const { container, input, unmount } = await render();
  await type(input, 'דנה כהן');
  assert.ok(rows(container).some((r) => r.textContent.includes('דנה כהן')));
  assert.ok(!container.textContent.includes('+ ליד'));
  await unmount();
});

test('"+ ליד" opens the canonical modal with the phone prefilled; cancel writes nothing', async () => {
  const { container, input, unmount } = await render();
  await type(input, '058-765-4321');

  const createRow = rows(container).find((r) => r.textContent.includes('+ ליד'));
  assert.ok(createRow, 'create row is offered for a valid unknown phone');
  await mousedown(createRow);
  await act(async () => {});

  // The canonical CreateDealModal, phone field prefilled with the ORIGINAL text.
  assert.ok(container.textContent.includes('דיל חדש'));
  const phoneLabel = [...container.querySelectorAll('label')].find((l) => l.textContent.includes('טלפון'));
  assert.equal(phoneLabel.querySelector('input').value, '058-765-4321');
  // Name field stays empty — the phone never lands in the name.
  const nameLabel = [...container.querySelectorAll('label')].find((l) => l.textContent.includes('שם מלא'));
  assert.equal(nameLabel.querySelector('input').value, '');

  // Nothing was created by opening the modal.
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);

  // Cancel → modal gone, still nothing written.
  const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === 'ביטול');
  await act(async () => { cancel.click(); });
  assert.ok(!container.textContent.includes('דיל חדש'));
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);

  // The committed search landed in the per-operator recent history.
  const stored = JSON.parse(window.localStorage.getItem(RECENTS_KEY));
  assert.equal(stored.items[0].q, '058-765-4321');
  assert.equal(stored.items[0].kind, 'phone');
  await unmount();
});

test('a Hebrew-name "+ ליד" prefills the full-name field', async () => {
  const { container, input, unmount } = await render();
  await type(input, 'יוסי לוי');

  const createRow = rows(container).find((r) => r.textContent.includes('+ ליד'));
  assert.ok(createRow);
  await mousedown(createRow);
  await act(async () => {});

  const nameLabel = [...container.querySelectorAll('label')].find((l) => l.textContent.includes('שם מלא'));
  assert.equal(nameLabel.querySelector('input').value, 'יוסי לוי');
  const phoneLabel = [...container.querySelectorAll('label')].find((l) => l.textContent.includes('טלפון'));
  assert.equal(phoneLabel.querySelector('input').value, '');
  await unmount();
});

test('selecting a result records the query as a recent search', async () => {
  const { container, input, unmount } = await render();
  await type(input, 'דנה כהן');
  const row = rows(container).find((r) => r.textContent.includes('דנה כהן'));
  await mousedown(row);

  const stored = JSON.parse(window.localStorage.getItem(RECENTS_KEY));
  assert.equal(stored.items[0].q, 'דנה כהן');
  await unmount();
});
