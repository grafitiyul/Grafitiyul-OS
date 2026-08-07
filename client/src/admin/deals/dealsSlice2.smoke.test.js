import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

// Slice 2 behaviour, rendered rather than assumed:
//   • a Deal task row opens the editor when you click ANYWHERE on it, while the
//     done-checkbox and the ⋮ menu keep doing only their own job;
//   • the same row is keyboard-operable;
//   • the silent-WON dialog opens with SAFE defaults and never sends an email
//     or creates a tour unless asked;
//   • no active UI file still spells a Deal's CRM status the old way.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'deals-slice2-smoke');

let React;
let MemoryRouter;
let createRoot;
let act;
let OpenTasksStrip;
let SilentWonDialog;
let posted = [];

const TASK = {
  id: 't1',
  title: 'להתקשר ללקוח',
  channel: null,
  icon: 'phone',
  dueDate: '2026-08-10T00:00:00.000Z',
  dueTime: null,
  priority: 'high',
  ownerUserId: null,
  status: 'open',
};

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
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
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
    if (opts.method && opts.method !== 'GET') posted.push({ url: u, body: opts.body });
    let body = {};
    if (u.startsWith('/api/admin-users')) body = { users: [{ id: 'u1', username: 'admin' }] };
    else if (u.includes('/silent-won/plan')) {
      body = {
        alreadyWon: false, previousStatus: 'open', createTour: false,
        missingForTour: [], needsSlot: false, canCreateTour: true,
        tourDate: '2023-07-18', tourTime: '16:00', activityType: 'business',
        hasActiveBooking: false, alreadyHistoricallyCorrected: false,
      };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const build = async (entry, out) => {
    const outfile = path.join(cacheDir, out);
    await esbuild.build({
      entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser',
      jsx: 'automatic', packages: 'external', plugins: [assetStubPlugin], outfile, logLevel: 'silent',
    });
    return (await import(pathToFileURL(outfile).href)).default;
  };
  OpenTasksStrip = await build(path.join(here, 'tasks', 'OpenTasksStrip.jsx'), 'tasks.bundle.mjs');
  SilentWonDialog = await build(path.join(here, 'SilentWonDialog.jsx'), 'silentwon.bundle.mjs');

  React = (await import('react')).default;
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  posted = [];
});

async function render(el) {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  await act(async () => root.render(React.createElement(MemoryRouter, null, el)));
  await act(async () => {});
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

const editorOpen = (container) => !!container.querySelector('textarea');

// ── task row ────────────────────────────────────────────────────────────────

test('clicking anywhere on a task row opens the editor', async () => {
  const { container, unmount } = await render(
    React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [TASK], onChanged: () => {} }),
  );
  assert.equal(editorOpen(container), false, 'starts closed');
  const row = container.querySelector('li[role="button"]');
  assert.ok(row, 'the row is a real activatable control');
  // Click the plain TITLE text, not any button — the whole row must respond.
  const title = [...row.querySelectorAll('div')].find((d) => d.textContent.trim() === TASK.title);
  assert.ok(title, 'the title cell exists');
  await act(async () => title.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.equal(editorOpen(container), true, 'the editor opened');
  await unmount();
});

test('the row is keyboard operable (Enter and Space)', async () => {
  for (const key of ['Enter', ' ']) {
    const { container, unmount } = await render(
      React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [TASK], onChanged: () => {} }),
    );
    const row = container.querySelector('li[role="button"]');
    assert.equal(row.getAttribute('tabindex'), '0', 'the row is focusable');
    await act(async () =>
      row.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })),
    );
    assert.equal(editorOpen(container), true, `${key} opened the editor`);
    await unmount();
  }
});

test('the done checkbox completes the task and does NOT open the editor', async () => {
  const { container, unmount } = await render(
    React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [TASK], onChanged: () => {} }),
  );
  // The shared TaskCheckbox (one control across the Deal strip, the Tasks
  // table and the cards) — found by its stable hook, not by a label string.
  const done = container.querySelector('[data-task-check="open"]');
  assert.ok(done, 'the complete control exists');
  await act(async () => done.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await act(async () => {});
  assert.equal(editorOpen(container), false, 'the editor stayed closed');
  assert.ok(
    posted.some((p) => /\/tasks\/t1\/complete/.test(p.url)),
    `the complete call fired (${JSON.stringify(posted.map((p) => p.url))})`,
  );
  await unmount();
});

test('the ⋮ menu opens its menu and does NOT open the editor', async () => {
  const { container, unmount } = await render(
    React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [TASK], onChanged: () => {} }),
  );
  const kebab = container.querySelector('button[aria-label="פעולות"]');
  assert.ok(kebab, 'the ⋮ button exists');
  await act(async () => kebab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.equal(editorOpen(container), false, 'the editor stayed closed');
  assert.equal(kebab.getAttribute('aria-expanded'), 'true', 'the menu opened');
  // …and its Edit entry still works — the secondary path is not removed.
  const edit = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'עריכה');
  assert.ok(edit, 'the menu still offers עריכה');
  await act(async () => edit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.equal(editorOpen(container), true, 'the menu route opens the SAME editor');
  await unmount();
});

// ── silent WON dialog ───────────────────────────────────────────────────────

test('the silent-WON dialog opens with safe defaults', async () => {
  const deal = { id: 'd1', status: 'open', tourDate: '2023-07-18', participants: 13 };
  const { container, unmount } = await render(
    React.createElement(SilentWonDialog, { open: true, deal, onClose: () => {}, onDone: () => {} }),
  );
  await act(async () => {});
  const boxes = [...container.querySelectorAll('input[type="checkbox"]')];
  assert.equal(boxes.length, 2, 'email + tour checkboxes');
  assert.ok(boxes.every((b) => b.checked === false), 'BOTH default to off');
  const html = container.innerHTML;
  assert.match(html, /שלח מייל אישור/);
  assert.match(html, /הקם סיור אמיתי/);
  // The date default is visible, not silent: a deal with a tour date defaults
  // to that historical date, never today.
  const custom = [...container.querySelectorAll('input[type="radio"]')][1];
  assert.equal(custom.checked, true, 'תאריך אחר is preselected for a historical deal');
  assert.match(html, /2023-07-18|18\.07\.2023/);
  await unmount();
});

test('the dialog states that no money, document or collection state changes', async () => {
  const deal = { id: 'd1', status: 'open', tourDate: '2023-07-18', participants: 13 };
  const { container, unmount } = await render(
    React.createElement(SilentWonDialog, { open: true, deal, onClose: () => {}, onDone: () => {} }),
  );
  await act(async () => {});
  const text = container.textContent;
  assert.match(text, /תשלומים, מסמכים וגבייה: ללא שינוי/);
  assert.match(text, /לא ייווצר \(יירשם כתיקון היסטורי מכוון\)/);
  await unmount();
});

test('confirming with the defaults sends neither an email nor a tour request', async () => {
  const deal = { id: 'd1', status: 'open', tourDate: '2023-07-18', participants: 13 };
  const { container, unmount } = await render(
    React.createElement(SilentWonDialog, { open: true, deal, onClose: () => {}, onDone: () => {} }),
  );
  await act(async () => {});
  const submit = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('בצע תיקון'));
  assert.ok(submit, 'the confirm button exists');
  await act(async () => submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await act(async () => {});
  const call = posted.find((p) => p.url.includes('/silent-won'));
  assert.ok(call, 'the correction was requested');
  const body = JSON.parse(call.body);
  assert.equal(body.sendConfirmationEmail, false);
  assert.equal(body.createTour, false);
  assert.equal(body.wonDateMode, 'custom');
  assert.equal(body.wonDate, '2023-07-18', 'the historical date is not rewritten to today');
  await unmount();
});

// ── LOST vocabulary: no old spelling left in active UI code ─────────────────

test('no active UI file still spells a Deal CRM status the old way', () => {
  const src = path.join(clientRoot, 'src');
  // The three retired spellings, as they appeared in a deal-status map.
  const OFFENDERS = [
    /\bwon:\s*(\{\s*label:\s*)?'נסגר'/,
    /\blost:\s*(\{\s*label:\s*)?'אבוד'/,
    /'סיבת הפסד'/,
    /'הערות הפסד'/,
  ];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(p);
      } else if (/\.(jsx?|mjs)$/.test(entry.name) && !/\.test\.[jm]s$/.test(entry.name)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const re of OFFENDERS) if (re.test(text)) offenders.push(`${path.relative(clientRoot, p)} :: ${re}`);
      }
    }
  };
  walk(src);
  assert.deepEqual(offenders, [], `retired CRM status wording still present:\n${offenders.join('\n')}`);
});

test('ordinary Hebrew that is unrelated to CRM status is left alone', () => {
  // The inbox "these deals are old (lost or the tour already happened)" copy is
  // a natural sentence, not a status label — it must survive the sweep.
  const inbox = fs.readFileSync(path.join(clientRoot, 'src', 'admin', 'whatsapp', 'WhatsAppInbox.jsx'), 'utf8');
  assert.match(inbox, /אבודים או שהסיור כבר עבר/);
});

// ── The completion checkbox is the only interactive thing in the row ────────

test('the task row has NO hover tint or border change', async () => {
  // Lighting the row up as the pointer travelled toward the checkbox read as
  // "this task is about to be selected/ticked". The row is still clickable —
  // it opens the editor — but hover feedback belongs to the controls inside it.
  const { container, unmount } = await render(
    React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [TASK], onChanged: () => {} }),
  );
  const row = container.querySelector('li[role="button"]');
  assert.ok(row, 'the row is there');
  assert.ok(!/hover:border-/.test(row.className), 'no hover border');
  assert.ok(!/hover:bg-/.test(row.className), 'no hover background');
  assert.ok(!/hover:ring-/.test(row.className), 'no hover ring');
  // Keyboard focus is NOT hover and must keep its ring.
  assert.match(row.className, /focus-visible:ring-2/, 'keyboard focus is still visible');
  await unmount();
});

