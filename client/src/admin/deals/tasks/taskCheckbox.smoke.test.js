import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// The completion control, rendered for real. The reported problems were both
// about how the control BEHAVES under the pointer:
//   * hovering previewed a ✓, so a task you were only pointing at looked done,
//     and the appearing/disappearing glyph made the list feel jumpy;
//   * a completed task had no way back from the same control.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'task-checkbox-smoke');

let React;
let createRoot;
let act;
let TaskCheckbox;

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MouseEvent = window.MouseEvent;
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'taskCheckbox.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'TaskCheckbox.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    outfile,
    logLevel: 'silent',
  });
  TaskCheckbox = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(TaskCheckbox, props)));
  return {
    box: () => host.querySelector('[data-task-check]'),
    rerender: async (next) => {
      await act(async () => root.render(React.createElement(TaskCheckbox, { ...props, ...next })));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

test('an OPEN task shows a stable empty box — no ✓ previewed on hover', async () => {
  const v = await render({ status: 'open', onComplete: () => {} });
  const cls = v.box().className;
  // The glyph is always in the DOM; only its colour changes. So there is no
  // hover rule that reveals a check, and nothing can appear or disappear.
  assert.equal(v.box().textContent, '✓', 'the glyph is always present…');
  assert.match(cls, /text-transparent/, '…and invisible while the task is open');
  assert.ok(!/hover:text-/.test(cls), 'no hover rule paints the check in');
  assert.match(cls, /hover:border-emerald-500/, 'hover changes the border');
  assert.match(cls, /hover:bg-emerald-50/, 'and the background — nothing else');
  await v.unmount();
});

test('the control is exactly the same size in every state — nothing shifts', async () => {
  const sizeOf = (cls) => (cls.match(/\bh-\d+ w-\d+\b/) || [])[0];
  const open = await render({ status: 'open', onComplete: () => {} });
  const openSize = sizeOf(open.box().className);
  assert.ok(openSize, 'the box has a fixed size');
  for (const status of ['completed', 'cancelled', 'sent', 'not_sent']) {
    await open.rerender({ status });
    assert.equal(sizeOf(open.box().className), openSize, `${status} is the same size`);
  }
  await open.unmount();
});

test('one click completes — and the pending request locks the control', async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const v = await render({
    status: 'open',
    onComplete: () => { calls.push('complete'); return gate; },
  });

  await click(v.box());
  assert.deepEqual(calls, ['complete']);
  assert.equal(v.box().disabled, true, 'locked while the request is in flight');

  // A frantic double click cannot flip it twice.
  await click(v.box());
  assert.deepEqual(calls, ['complete'], 'still exactly one transition');

  await act(async () => { release(); });
  await v.unmount();
});

test('a COMPLETED task shows the check clearly, and clicking it reopens', async () => {
  const calls = [];
  const v = await render({
    status: 'completed',
    onComplete: () => calls.push('complete'),
    onReopen: () => calls.push('reopen'),
  });
  assert.equal(v.box().getAttribute('data-task-check'), 'done');
  assert.equal(v.box().getAttribute('aria-checked'), 'true');
  assert.match(v.box().className, /bg-emerald-500/, 'filled, unmistakably done');
  assert.match(v.box().className, /text-white/, 'the ✓ is visible, not transparent');

  await click(v.box());
  assert.deepEqual(calls, ['reopen'], 'the same control is the way back');
  await v.unmount();
});

test('cancelled and not_sent tasks reopen too; a SENT message is final', async () => {
  const calls = [];
  const v = await render({ status: 'cancelled', onComplete: () => calls.push('c'), onReopen: () => calls.push('reopen') });
  await click(v.box());
  await v.rerender({ status: 'not_sent' });
  await click(v.box());
  assert.deepEqual(calls, ['reopen', 'reopen']);

  // The message went out — reopening would misrepresent messaging history.
  await v.rerender({ status: 'sent' });
  assert.equal(v.box().disabled, true);
  assert.equal(v.box().getAttribute('data-task-check'), 'final');
  await click(v.box());
  assert.deepEqual(calls, ['reopen', 'reopen'], 'a sent task never transitions from here');
  await v.unmount();
});

test('a failed transition unlocks and leaves the visual state truthful', async () => {
  const v = await render({
    status: 'open',
    onComplete: () => Promise.reject(new Error('network')),
  });
  await click(v.box());
  assert.equal(v.box().disabled, false, 'unlocked, so the operator can retry');
  // The status prop never changed, so the box still says "open" — the control
  // holds no optimistic state the server refused.
  assert.equal(v.box().getAttribute('data-task-check'), 'open');
  await v.unmount();
});

test('it never asks for confirmation — the same click undoes it', async () => {
  const v = await render({ status: 'open', onComplete: () => {}, onReopen: () => {} });
  assert.equal(document.body.querySelector('[role="dialog"]'), null);
  await click(v.box());
  assert.equal(document.body.querySelector('[role="dialog"]'), null);
  await v.unmount();
});

test('every task surface uses THIS control — none hand-rolls its own', async () => {
  // "Ensure this behavior is identical inside the full Deal, inside the Tasks
  // drawer, and wherever the same row component is used." The only way that
  // stays true is if no surface draws its own completion button.
  const { readFileSync } = await import('node:fs');
  const SURFACES = [
    'admin/deals/tasks/OpenTasksStrip.jsx',
    'admin/crm/tasks/TasksWorkspace.jsx',
    'admin/crm/tasks/TaskCards.jsx',
  ];
  const src = path.resolve(here, '..', '..', '..');
  for (const rel of SURFACES) {
    const text = readFileSync(path.join(src, rel), 'utf8');
    assert.match(text, /<TaskCheckbox/, `${rel} renders the shared control`);
    // The two hand-rolled glyph buttons this replaced.
    assert.ok(!/text-transparent[^"'`]*hover:text-/.test(text), `${rel} has no hover-revealed check`);
    assert.ok(
      !/>\s*↩\s*</.test(text),
      `${rel} has no separate reopen button — the check itself is the toggle`,
    );
  }
});
