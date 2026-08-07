import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// WHERE a task is IS its status.
//
//   OPEN      → the Focus strip
//   COMPLETED → History, as a completed row whose checkbox reopens it
//   REOPENED  → Focus again
//
// Nothing is pinned in Focus to make undo possible. These tests render the two
// real components and prove a task moves between the sections on its real
// status, keeping one id and creating no replacement row.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'task-sections-smoke');

let React;
let createRoot;
let act;
let OpenTasksStrip;
let TaskEventRow;
let posted = [];

const TASK_OPEN = {
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
const TASK_DONE = { ...TASK_OPEN, status: 'completed', completedAt: '2026-08-07T10:00:00.000Z' };

// The timeline entry the backend writes on completion.
const ENTRY_COMPLETED = {
  id: 'e_done',
  kind: 'task',
  createdAt: '2026-08-07T10:00:00.000Z',
  createdByName: 'admin',
  body: 'המשימה הושלמה',
  data: { event: 'task_completed', taskId: 't1', title: TASK_OPEN.title, icon: 'phone', channel: 'none', status: 'completed' },
};

before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (opts.method && opts.method !== 'GET') posted.push({ url: u, body: opts.body });
    let body = {};
    if (u.startsWith('/api/admin-users')) body = { users: [{ id: 'u1', username: 'admin' }] };
    if (u === '/api/tasks/bulk') body = { results: [{ id: 't1', ok: true }] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const build = async (entry, out) => {
    const outfile = path.join(cacheDir, out);
    await esbuild.build({
      entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser',
      jsx: 'automatic', packages: 'external', outfile, logLevel: 'silent',
      plugins: [{
        name: 'asset-stub',
        setup(b) {
          b.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (a) => ({ path: a.path, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
        },
      }],
    });
    return import(pathToFileURL(outfile).href);
  };
  OpenTasksStrip = (await build(path.join(here, 'OpenTasksStrip.jsx'), 'strip.bundle.mjs')).default;
  TaskEventRow = (await build(path.join(here, 'TaskEventRow.jsx'), 'row.bundle.mjs')).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  posted = [];
});

async function render(el) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(el));
  await act(async () => {});
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const click = async (el) => {
  await act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await act(async () => {});
};

// ── Focus holds open tasks only ────────────────────────────────────────────

test('Focus shows an OPEN task with an empty checkbox', async () => {
  const v = await render(
    React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [TASK_OPEN], onChanged: () => {} }),
  );
  const box = v.host.querySelector('[data-task-check]');
  assert.equal(box.getAttribute('data-task-check'), 'open');
  assert.match(box.className, /text-transparent/, 'empty — no tick is shown');
  await v.unmount();
});

test('a completed task is NOT held in Focus — the section only renders what it is given', async () => {
  // The parent feeds Focus the OPEN tasks. After a completion that list is
  // empty, and the strip must render nothing rather than pin the finished row.
  const v = await render(
    React.createElement(OpenTasksStrip, { dealId: 'd1', tasks: [], onChanged: () => {} }),
  );
  assert.equal(v.host.querySelector('[data-task-check]'), null, 'nothing left in Focus');
  assert.equal(v.host.textContent.trim(), '', 'the section disappears entirely');
  await v.unmount();
});

test('completing calls the canonical complete endpoint and tells the parent to refetch', async () => {
  const causes = [];
  const v = await render(
    React.createElement(OpenTasksStrip, {
      dealId: 'd1', tasks: [TASK_OPEN], onChanged: (c) => causes.push(c),
    }),
  );
  await click(v.host.querySelector('[data-task-check="open"]'));
  assert.ok(posted.some((p) => /\/deals\/d1\/tasks\/t1\/complete$/.test(p.url)), 'canonical complete');
  assert.equal(causes.length, 1, 'the parent was told to reload — that is what moves the row');
  assert.equal(causes[0].taskId, 't1');
  await v.unmount();
});

// ── History holds the completed task, and owns the way back ────────────────

const historyRow = (props) =>
  React.createElement(TaskEventRow, {
    entry: ENTRY_COMPLETED,
    task: TASK_DONE,
    live: true,
    dealId: 'd1',
    userMap: { u1: 'admin' },
    onReopen: async () => {},
    ...props,
  });

test('the History row shows the task as completed, with a checked checkbox', async () => {
  const v = await render(historyRow());
  const box = v.host.querySelector('[data-task-check]');
  assert.ok(box, 'the completed task carries a checkbox in History');
  assert.equal(box.getAttribute('data-task-check'), 'done');
  assert.equal(box.getAttribute('aria-checked'), 'true');
  assert.equal(box.disabled, false, 'and it stays clickable');
  assert.ok(v.host.textContent.includes('הושלמה'), 'labelled as completed');
  await v.unmount();
});

test('clicking the checked checkbox in History reopens through the canonical flow', async () => {
  const reopened = [];
  const v = await render(historyRow({ onReopen: async (t) => reopened.push(t.id) }));
  await click(v.host.querySelector('[data-task-check="done"]'));
  assert.deepEqual(reopened, ['t1'], 'the SAME task id — no replacement row');
  await v.unmount();
});

test('once the task is open again, its completion line is history — no control on it', async () => {
  // The task now lives in Focus. The completion entry stays as an audit line
  // (reopening writes its own entry rather than erasing the completion), but it
  // is no longer the task's current state, so it carries nothing to click.
  const v = await render(historyRow({ task: { ...TASK_DONE, status: 'open' } }));
  assert.equal(v.host.querySelector('[data-task-check]'), null, 'no checkbox on a superseded line');
  assert.ok(v.host.textContent.includes('הושלמה'), 'the audit line itself is untouched');
  await v.unmount();
});

test('an OLDER completion from a previous cycle is never actionable', async () => {
  // complete → reopen → complete leaves two task_completed entries. Only the
  // newest represents the task; the earlier one must not offer a second,
  // conflicting control.
  const v = await render(historyRow({ live: false }));
  assert.equal(v.host.querySelector('[data-task-check]'), null);
  await v.unmount();
});

test('a task with no live record loaded stays inert rather than guessing', async () => {
  const v = await render(historyRow({ task: null }));
  assert.equal(v.host.querySelector('[data-task-check]'), null);
  assert.ok(v.host.textContent.includes('הושלמה'), 'still readable history');
  await v.unmount();
});

test('a SENT WhatsApp task is final in History too', async () => {
  const v = await render(historyRow({ task: { ...TASK_DONE, status: 'sent' } }));
  const box = v.host.querySelector('[data-task-check]');
  assert.equal(box.getAttribute('data-task-check'), 'final');
  assert.equal(box.disabled, true, 'the message went out — nothing to undo');
  await v.unmount();
});

test('the History row is clickable to edit, and the checkbox does not open the editor', async () => {
  const v = await render(historyRow());
  // Ticking is not editing.
  await click(v.host.querySelector('[data-task-check="done"]'));
  assert.equal(v.host.querySelector('textarea'), null, 'the editor stayed closed');
  // Clicking the row body opens the SAME task editor the Focus strip uses.
  const label = [...v.host.querySelectorAll('*')].find((el) => el.textContent === TASK_OPEN.title);
  await click(label);
  assert.ok(v.host.querySelector('textarea'), 'the shared task editor opened');
  await v.unmount();
});

test('reopening never creates a task — only the transition endpoint is called', async () => {
  let called = null;
  const v = await render(
    historyRow({
      onReopen: async (t) => {
        const res = await fetch('/api/tasks/bulk', {
          method: 'POST',
          body: JSON.stringify({ action: 'reopen', ids: [t.id] }),
        });
        called = await res.json();
      },
    }),
  );
  await click(v.host.querySelector('[data-task-check="done"]'));
  assert.deepEqual(JSON.parse(posted[0].body), { action: 'reopen', ids: ['t1'] });
  assert.ok(!posted.some((p) => /\/tasks$/.test(p.url)), 'nothing was created');
  assert.deepEqual(called, { results: [{ id: 't1', ok: true }] });
  await v.unmount();
});
