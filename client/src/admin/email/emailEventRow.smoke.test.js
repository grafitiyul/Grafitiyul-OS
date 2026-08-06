import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// RENDERS the real EmailEventRow (esbuild bundle, jsdom) and proves in the DOM
// that a timeline email row is useful on its own and opens the CANONICAL thread.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'email-event-row-smoke');

let React;
let createRoot;
let act;
let EmailEventRow;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

const entry = (data, over = {}) => ({
  id: 'email:m1',
  kind: 'email',
  createdAt: '2026-08-06T09:00:00.000Z',
  createdByName: 'admin',
  data: {
    emailMessageId: 'm1', threadId: 'th1', direction: 'inbound', deliveryState: 'received',
    sentFromGos: false, subject: 'שאלה על הסיור', snippet: 'רציתי לברר לגבי התאריך',
    fromName: 'דנה כהן', fromEmail: 'dana@x.co.il',
    toRecipients: [{ name: 'גרפיטיול', email: 'info@grafitiyul.co.il' }],
    ccRecipients: [], hasAttachments: false, attachmentCount: 0,
    threadMessageCount: 1, threadUnread: false, engagement: null,
    ...data,
  },
  ...over,
});

before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'row.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'EmailEventRow.jsx')],
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    packages: 'external', plugins: [assetStubPlugin], outfile, logLevel: 'silent',
  });
  EmailEventRow = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(EmailEventRow, props));
  });
  return { host, root, text: () => host.textContent || '' };
}

test('a RECEIVED email row shows direction, subject, sender and snippet', async () => {
  const { text, root } = await render({ entry: entry({}) });
  assert.match(text(), /התקבל מייל/);
  assert.match(text(), /שאלה על הסיור/);
  assert.match(text(), /דנה כהן/, 'who it is from');
  assert.match(text(), /רציתי לברר/, 'a useful snippet');
  root.unmount();
});

test('a SENT email row shows direction and its RECIPIENTS', async () => {
  const { text, root } = await render({
    entry: entry({ direction: 'outbound', deliveryState: 'sent', toRecipients: [{ name: 'דנה כהן' }] }),
  });
  assert.match(text(), /נשלח מייל/);
  assert.match(text(), /אל:/);
  assert.match(text(), /דנה כהן/);
  root.unmount();
});

test('attachments show a COUNT, and CC says how many others got it', async () => {
  const { text, root } = await render({
    entry: entry({ hasAttachments: true, attachmentCount: 3, ccRecipients: [{ email: 'a@b.c' }, { email: 'd@e.f' }] }),
  });
  assert.match(text(), /3/);
  assert.match(text(), /עותק ל-2/);
  root.unmount();
});

test('an unread thread is marked, and the thread size is shown', async () => {
  const { host, root } = await render({ entry: entry({ threadUnread: true, threadMessageCount: 5 }) });
  assert.ok(host.querySelector('[aria-label="לא נקרא"]'), 'unread is visible');
  assert.match(host.textContent, /5/, 'thread message count');
  root.unmount();
});

// ── delivery truth on screen ────────────────────────────────────────────────

test('queued / failed / cancelled never render as "נשלח מייל"', async () => {
  for (const [state, label] of [
    ['queued', 'ממתין לשליחה'],
    ['failed', 'שליחה נכשלה'],
    ['cancelled', 'בוטל'],
  ]) {
    const { text, root } = await render({ entry: entry({ direction: 'outbound', deliveryState: state }) });
    assert.match(text(), new RegExp(label), state);
    assert.doesNotMatch(text(), /נשלח מייל/, `${state} must not read as sent`);
    root.unmount();
  }
});

test('a failed send states its reason', async () => {
  const { text, root } = await render({
    entry: entry({ direction: 'outbound', deliveryState: 'failed', failureReason: 'invalid recipient' }),
  });
  assert.match(text(), /invalid recipient/);
  root.unmount();
});

test('GOS provenance shows only where it is a recorded fact', async () => {
  const gos = await render({ entry: entry({ direction: 'outbound', deliveryState: 'sent', sentFromGos: true }) });
  assert.match(gos.text(), /GOS/);
  gos.root.unmount();
  const unknown = await render({ entry: entry({ direction: 'outbound', deliveryState: 'sent', sentFromGos: false }) });
  assert.doesNotMatch(unknown.text(), /GOS/);
  unknown.root.unmount();
});

// ── opening the canonical thread ────────────────────────────────────────────

test('clicking the row opens the thread by its CANONICAL id, with the subject', async () => {
  const opened = [];
  const { host, root } = await render({ entry: entry({}), onOpenThread: (t) => opened.push(t) });
  const btn = host.querySelector('button');
  assert.ok(btn, 'the whole row is clickable');
  await act(async () => { btn.click(); });
  assert.deepEqual(opened, [{ id: 'th1', subject: 'שאלה על הסיור' }]);
  root.unmount();
});

test('a row with no thread identity degrades safely — readable, not clickable', async () => {
  // A queued brand-new message has no thread yet. It must NOT become a button
  // that opens something unrelated.
  const { host, text, root } = await render({
    entry: entry({ threadId: null, deliveryState: 'queued', direction: 'outbound' }),
    onOpenThread: () => { throw new Error('must not be openable'); },
  });
  assert.equal(host.querySelector('button'), null, 'no click target');
  assert.match(text(), /ממתין לשליחה/, 'but everything known is still shown');
  assert.match(text(), /שאלה על הסיור/);
  root.unmount();
});

test('with no handler at all the row is inert (read-only surfaces)', async () => {
  const { host, root } = await render({ entry: entry({}) });
  assert.equal(host.querySelector('button'), null);
  root.unmount();
});
