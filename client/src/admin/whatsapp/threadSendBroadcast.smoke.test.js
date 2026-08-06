import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// A WhatsApp message sent from ANOTHER composer on the same conversation must
// appear in the already-open thread immediately. This RENDERS the real
// ChatThread (esbuild bundle, jsdom) and proves in the actual DOM that:
//   1. the sent message appears without any refetch or remount;
//   2. the SAME message arriving again (the bridge's later sync) does not
//      produce a second bubble — merging is by message id;
//   3. an event for a DIFFERENT conversation is ignored (per-account safety:
//      the same person on our other number is a different chat id).

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'thread-send-smoke');

let React;
let createRoot;
let act;
let ChatThread;
let WHATSAPP_MESSAGE_SENT_EVENT;
let announceWhatsappMessageSent;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

// The network is not what this test is about: every api call resolves to an
// empty page, so the ONLY way a bubble can reach the DOM is the broadcast.
const apiStubPlugin = {
  name: 'api-stub',
  setup(build) {
    build.onResolve({ filter: /lib\/api\.js$/ }, (args) => ({ path: args.path, namespace: 'api-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'api-stub' }, () => ({
      contents: `
        const page = async () => ({ messages: [], hasMore: false });
        export const api = {
          whatsapp: {
            chatMessages: page,
            starMessage: async () => ({}),
            sendMessage: async () => ({ message: null }),
            sendMedia: async () => ({ message: null }),
            sendVoice: async () => ({ message: null }),
            scheduleMessage: async () => ({}),
            scheduledForChat: page,
          },
        };
      `,
      loader: 'js',
    }));
  },
};

const CHAT = {
  id: 'chat_a1',
  accountId: 'acc1',
  type: 'private',
  displayName: 'ישראל ישראלי',
  phoneNumber: '972501234567',
  account: { id: 'acc1', label: 'מספר ראשי' },
};

const SENT = {
  id: 'msg_tpl_1',
  direction: 'outgoing',
  textContent: 'שלום ישראל, מצרפים את פרטי הסיור',
  timestampFromSource: '2026-08-06T09:00:00.000Z',
  status: 'sent',
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
  const outfile = path.join(cacheDir, 'thread.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'threadSmokeEntry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [apiStubPlugin, assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  ChatThread = mod.ChatThread;
  WHATSAPP_MESSAGE_SENT_EVENT = mod.WHATSAPP_MESSAGE_SENT_EVENT;
  announceWhatsappMessageSent = mod.announceWhatsappMessageSent;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function mountThread() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(ChatThread, { chat: CHAT, canSend: true }));
  });
  // let the initial (empty) load settle
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { host, root };
}

const bubblesWith = (host, text) =>
  [...host.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent.trim() === text,
  );

test('a send from another composer appears in the open thread with no refetch', async () => {
  const { host, root } = await mountThread();
  assert.equal(bubblesWith(host, SENT.textContent).length, 0, 'nothing on screen to begin with');

  await act(async () => {
    announceWhatsappMessageSent({ chatId: CHAT.id, message: SENT });
  });
  assert.equal(bubblesWith(host, SENT.textContent).length, 1, 'the sent message is on screen');
  root.unmount();
});

test('the bridge syncing the SAME message later does not duplicate it', async () => {
  const { host, root } = await mountThread();
  await act(async () => {
    announceWhatsappMessageSent({ chatId: CHAT.id, message: SENT });
  });
  // Same id, the shape the bridge sync delivers (delivery state moved on).
  await act(async () => {
    announceWhatsappMessageSent({ chatId: CHAT.id, message: { ...SENT, status: 'delivered' } });
  });
  assert.equal(bubblesWith(host, SENT.textContent).length, 1, 'still exactly one bubble');
  root.unmount();
});

test('a send on ANOTHER conversation is ignored (same person, our other number)', async () => {
  const { host, root } = await mountThread();
  await act(async () => {
    announceWhatsappMessageSent({ chatId: 'chat_b1', message: SENT });
  });
  assert.equal(bubblesWith(host, SENT.textContent).length, 0);
  root.unmount();
});

test('the broadcast is inert without a live chat id', () => {
  let fired = 0;
  const onEvt = () => { fired += 1; };
  window.addEventListener(WHATSAPP_MESSAGE_SENT_EVENT, onEvt);
  announceWhatsappMessageSent({ chatId: null, message: SENT });
  window.removeEventListener(WHATSAPP_MESSAGE_SENT_EVENT, onEvt);
  assert.equal(fired, 0, 'a draft chat that never materialized announces nothing');
});
