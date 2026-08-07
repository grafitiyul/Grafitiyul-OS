import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// The hover peek's whole promise is that LOOKING COSTS NOTHING. This renders
// the real ChatListRow with the api module replaced by a recorder, hovers a
// row, and proves in the actual DOM that the peek:
//   1. reads the conversation through the pure-read messages endpoint ONLY;
//   2. never marks the chat read and never writes anything;
//   3. never opens the conversation or changes the selection;
//   4. renders WhatsApp formatting rather than raw markers;
//   5. does not fire at all when the pointer just passes through.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'chat-peek-smoke');

let React;
let createRoot;
let act;
let ChatListRow;

// Every api.* call is recorded. Only chatMessages resolves with data; anything
// else the component might reach for shows up in `calls` and fails the test.
const calls = [];
const apiStub = `
export const api = new Proxy({}, {
  get: (_t, ns) => new Proxy({}, {
    get: (_t2, method) => (...args) => {
      globalThis.__peekCalls.push({ ns: String(ns), method: String(method), args });
      if (method === 'chatMessages') {
        return Promise.resolve({ messages: [
          { id: 'm2', direction: 'incoming', messageType: 'text', textContent: 'זה *דחוף* בבקשה',
            timestampFromSource: '2026-08-06T09:05:00.000Z' },
          { id: 'm1', direction: 'outgoing', messageType: 'text', textContent: 'שלח לנו פרטים',
            deliveryStatus: 'read', timestampFromSource: '2026-08-06T09:00:00.000Z' },
        ], hasMore: false });
      }
      return Promise.resolve({});
    },
  }),
});
export default api;
`;

const stubPlugin = {
  name: 'peek-stubs',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
    build.onResolve({ filter: /lib[\\/]api\.js$/ }, () => ({ path: 'api-stub', namespace: 'api-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'api-stub' }, () => ({ contents: apiStub, loader: 'js' }));
  },
};

const CHAT = {
  id: 'chat_peek',
  accountId: 'acc1',
  type: 'private',
  displayName: 'דור קורן',
  providerName: 'Dor Koren Grafitiyul',
  phoneNumber: '972501234567',
  lastMessageAt: '2026-08-06T09:05:00.000Z',
  unreadCount: 2,
  lastMessage: { direction: 'incoming', textContent: 'זה *דחוף* בבקשה' },
};

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.__peekCalls = calls;
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

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'chatPeek.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'ChatListRow.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [stubPlugin],
    outfile,
    logLevel: 'silent',
  });
  ChatListRow = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function renderRow(extra = {}) {
  calls.length = 0;
  const opened = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(ChatListRow, {
        chat: CHAT,
        unreadCount: 2,
        onOpen: (c) => opened.push(c.id),
        onTogglePin: () => {},
        onToggleRead: () => {},
        onToggleSnoozeMenu: () => {},
        onSnooze: () => {},
        ...extra,
      }),
    );
  });
  return { host, root, opened };
}

const row = (host) => host.querySelector('[data-chat-row]');
// React synthesizes onMouseEnter/onMouseLeave from mouseover/mouseout plus
// relatedTarget — dispatching native mouseenter/mouseleave would silently do
// nothing and make these tests pass for the wrong reason.
const enter = (el) =>
  el.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
const leave = (el) =>
  el.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

// The card is portaled onto <body>, so it is found there, not inside the host.
const peekPanel = () =>
  [...document.body.querySelectorAll('div')].find((d) => d.textContent?.includes('קריאה בלבד')) || null;

test('hovering a row peeks the conversation — and writes nothing', async () => {
  const { host, root, opened } = await renderRow();
  await act(async () => {
    enter(row(host));
  });
  await act(async () => {
    await tick(600); // past the hover delay
  });

  const panel = peekPanel();
  assert.ok(panel, 'the peek card is on screen');

  // 1 + 2: exactly one call, and it is the pure-read messages endpoint.
  assert.deepEqual(
    calls.map((c) => `${c.ns}.${c.method}`),
    ['whatsapp.chatMessages'],
    'the peek reads messages and nothing else',
  );
  assert.ok(!calls.some((c) => /mark|read|link|state|star|send/i.test(c.method)), 'no write of any kind');

  // 3: looking is not opening.
  assert.deepEqual(opened, [], 'the conversation was not opened');

  // 4: WhatsApp markup is rendered, not printed.
  assert.ok(!panel.textContent.includes('*דחוף*'), 'no raw asterisks in the peek');
  assert.ok([...panel.querySelectorAll('strong')].some((s) => s.textContent === 'דחוף'), 'bold is bold');

  await act(async () => root.unmount());
  host.remove();
});

test('passing the pointer through a row peeks nothing', async () => {
  const { host, root } = await renderRow();
  await act(async () => {
    enter(row(host));
    await tick(120);
    leave(row(host));
  });
  await act(async () => {
    await tick(600);
  });
  assert.deepEqual(calls, [], 'a pointer that kept moving fetched nothing');
  assert.equal(peekPanel(), null, 'and no card appeared');
  await act(async () => root.unmount());
  host.remove();
});

test('clicking the row still opens the conversation, and dismisses the peek', async () => {
  const { host, root, opened } = await renderRow();
  await act(async () => {
    enter(row(host));
    await tick(600);
  });
  assert.ok(peekPanel(), 'peeking first');
  await act(async () => {
    click(row(host));
  });
  assert.deepEqual(opened, ['chat_peek'], 'the click opened the conversation');
  assert.equal(peekPanel(), null, 'and the peek got out of the way');
  await act(async () => root.unmount());
  host.remove();
});

test('touch devices get no peek at all', async () => {
  const { host, root } = await renderRow({ peekDisabled: true });
  await act(async () => {
    enter(row(host));
    await tick(600);
  });
  assert.deepEqual(calls, [], 'nothing fetched');
  assert.equal(peekPanel(), null, 'nothing shown');
  await act(async () => root.unmount());
  host.remove();
});

test('the CRM name leads and the WhatsApp profile name follows it', async () => {
  const { host, root } = await renderRow();
  const text = row(host).textContent;
  assert.ok(text.includes('דור קורן'), 'CRM identity is primary');
  assert.ok(text.includes('WhatsApp: Dor Koren Grafitiyul'), 'WhatsApp-native name is secondary');
  await act(async () => root.unmount());
  host.remove();
});
