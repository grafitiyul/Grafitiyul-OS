import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// WhatsApp inbox conversation list smoke — RENDERS the real ChatListRow
// (esbuild bundle, jsdom) and proves in the actual DOM that:
//   1. the OPEN conversation's row carries the blue selected state + accent bar;
//   2. switching conversations moves that state (never two selected rows);
//   3. the same remote identity under another account does NOT light up;
//   4. the selected state does not fall back to the neutral hover tint;
//   5. an unread selected row keeps its bold text and its unread badge.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'chat-list-row-smoke');

let React;
let createRoot;
let act;
let ChatListRow;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

// Two accounts, the SAME remote number on each → two distinct chat rows.
const CHAT_A1 = {
  id: 'chat_a1',
  accountId: 'acc1',
  type: 'private',
  displayName: 'ישראל ישראלי',
  phoneNumber: '972501234567',
  lastMessageAt: '2026-08-05T09:00:00.000Z',
  lastMessage: { direction: 'incoming', textContent: 'שלום, מעוניין בסיור' },
  account: { id: 'acc1', label: 'מספר ראשי' },
};
const CHAT_A2 = {
  ...CHAT_A1,
  id: 'chat_a2',
  displayName: 'דנה כהן',
  phoneNumber: '972502222222',
  lastMessage: { direction: 'incoming', textContent: 'תודה!' },
};
// Same person, OTHER business number — a different row entirely.
const CHAT_B1 = {
  ...CHAT_A1,
  id: 'chat_b1',
  accountId: 'acc2',
  account: { id: 'acc2', label: 'מספר שני' },
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

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'chatListRow.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'ChatListRow.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  ChatListRow = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

// A list of rows, exactly as WhatsAppInbox renders it: `active` comes from the
// canonical account-scoped comparator.
function List({ chats, selected, unread = {} }) {
  const { isChatSelected } = List.selection;
  return React.createElement(
    'ul',
    null,
    chats.map((c) =>
      React.createElement(
        'li',
        { key: c.id },
        React.createElement(ChatListRow, {
          chat: c,
          active: isChatSelected(c, selected),
          unreadCount: unread[c.id] || 0,
          onOpen: () => {},
          onTogglePin: () => {},
          onToggleRead: () => {},
          onToggleSnoozeMenu: () => {},
          onSnooze: () => {},
        }),
      ),
    ),
  );
}

async function render(props) {
  List.selection = await import('./chatSelection.js');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(List, props)));
  await act(async () => {});
  return {
    container,
    rerender: async (next) => {
      await act(async () => root.render(React.createElement(List, next)));
      await act(async () => {});
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const rowOf = (container, id) => container.querySelector(`[data-chat-row="${id}"]`);
const selectedRows = (container) => [...container.querySelectorAll('[data-selected="true"]')];

test('the open conversation renders the blue selected state + accent bar', async () => {
  const { container, unmount } = await render({ chats: [CHAT_A1, CHAT_A2], selected: CHAT_A1 });

  const row = rowOf(container, 'chat_a1');
  assert.ok(row, 'the row rendered');
  assert.match(row.className, /bg-blue-500\/10/, 'semi-transparent blue fill');
  assert.match(row.className, /ring-blue-300/, 'blue inset ring');
  assert.equal(row.getAttribute('aria-current'), 'true', 'announced as the current row');
  assert.ok(
    [...row.querySelectorAll('span')].some((s) => /bg-blue-500/.test(s.className) && /w-\[3px\]/.test(s.className)),
    'the 3px blue accent bar is present',
  );
  // The other row is plainly unselected.
  assert.doesNotMatch(rowOf(container, 'chat_a2').className, /blue/);
  assert.equal(selectedRows(container).length, 1, 'exactly one selected row');
  await unmount();
});

test('switching conversations moves the selected state', async () => {
  const { container, rerender, unmount } = await render({ chats: [CHAT_A1, CHAT_A2], selected: CHAT_A1 });
  assert.deepEqual(selectedRows(container).map((r) => r.dataset.chatRow), ['chat_a1']);

  await rerender({ chats: [CHAT_A1, CHAT_A2], selected: CHAT_A2 });
  assert.deepEqual(
    selectedRows(container).map((r) => r.dataset.chatRow),
    ['chat_a2'],
    'the highlight follows the newly opened chat, and only it',
  );
  assert.doesNotMatch(rowOf(container, 'chat_a1').className, /bg-blue-500/);
  await unmount();
});

test('the same remote number under another account is NOT highlighted', async () => {
  // Selected: the conversation on account 1. Rendered: both accounts' rows
  // (the "כל המספרים" view).
  const { container, unmount } = await render({ chats: [CHAT_A1, CHAT_B1], selected: CHAT_A1 });
  assert.deepEqual(
    selectedRows(container).map((r) => r.dataset.chatRow),
    ['chat_a1'],
    "the other account's thread with the same person stays unselected",
  );
  assert.doesNotMatch(rowOf(container, 'chat_b1').className, /bg-blue-500/);
  await unmount();
});

test('a selected row never falls back to the neutral hover tint', async () => {
  const { container, unmount } = await render({ chats: [CHAT_A1], selected: CHAT_A1 });
  const cls = rowOf(container, 'chat_a1').className;
  assert.doesNotMatch(cls, /hover:bg-gray-/, 'hover cannot erase the selection');
  assert.match(cls, /hover:bg-blue-500\/20/, 'hover deepens the same blue');
  await unmount();
});

test('a selected UNREAD conversation keeps its bold text and unread badge', async () => {
  const { container, unmount } = await render({
    chats: [CHAT_A1, CHAT_A2],
    selected: CHAT_A1,
    unread: { chat_a1: 3 },
  });
  const row = rowOf(container, 'chat_a1');
  assert.match(row.className, /bg-blue-500\/10/, 'still visibly selected');
  assert.ok(
    [...row.querySelectorAll('span')].some((s) => s.textContent === '3' && /bg-emerald-500/.test(s.className)),
    'the unread count bubble is intact on a selected row',
  );
  assert.ok(
    [...row.querySelectorAll('span')].some(
      (s) => s.textContent.includes('ישראל ישראלי') && /font-bold/.test(s.className),
    ),
    'unread bolding survives selection',
  );
  await unmount();
});
