import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// "הודעה למדריך" — the default template + the per-template sending account.
// RENDERS the real dialog (esbuild bundle, jsdom) against a recording fetch
// stub and proves:
//
//   1. a default template LOADS ITSELF into the editor on open — no selection
//      click — and the message stays fully editable;
//   2. its configured account is preselected, labelled as coming from the
//      template;
//   3. no default ⇒ the composer opens empty (the old behaviour, unchanged);
//   4. switching template re-loads the wording AND re-suggests that template's
//      account;
//   5. changing the account is a PER-SEND choice: it rides in the send request
//      and writes nothing back to the template;
//   6. a template account that no longer exists is NOT swapped for another
//      number — the operator is warned and send stays blocked until they pick.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'guide-msg-default-smoke');

const ACCOUNTS = [
  { id: 'main', label: 'מכירות', connected: true, bridgeConfigured: true },
  { id: 'office', label: 'שירות לקוחות', connected: true, bridgeConfigured: true },
];

const SUBJECT = {
  tour: { id: 'te1', date: '2026-08-06', startTime: '18:00', productName: 'סיור גרפיטי', cityName: 'תל אביב' },
  dealId: 'd1',
  reviewItemId: 'ri1',
  recipients: [{
    personRefId: 'g1', name: 'רוני שלו', role: 'lead_guide', isLead: true,
    submittedSummary: true, phone: '0521234567', language: 'he', state: 'ok', canSend: true,
  }],
  defaultPersonRefId: 'g1',
  defaultLanguage: 'he',
  accounts: ACCOUNTS,
  // What the OPERATOR's remembered number would be, absent any template.
  defaultAccountId: 'main',
};

const T_DEFAULT = {
  id: 't1', nameHe: 'תודה על הסיכום', hasHe: true, hasEn: true, isActive: true,
  audience: 'guide', isAudienceDefault: true, sendAccountId: 'office', effectiveSendAccountId: 'office',
};
const T_OTHER = {
  id: 't2', nameHe: 'בקשת השלמה', hasHe: true, hasEn: false, isActive: true,
  audience: 'guide', isAudienceDefault: false, sendAccountId: 'main', effectiveSendAccountId: 'main',
};
// Configured to a number that no longer exists in the canonical list.
const T_RETIRED = {
  id: 't3', nameHe: 'תבנית עם מספר שהוסר', hasHe: true, hasEn: false, isActive: true,
  audience: 'guide', isAudienceDefault: true, sendAccountId: 'gone', effectiveSendAccountId: 'gone',
};

let calls = [];
let templates = [T_DEFAULT, T_OTHER];

let React;
let createRoot;
let act;
let GuideMessageDialog;

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
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  if (typeof globalThis.crypto === 'undefined') globalThis.crypto = { randomUUID: () => 'uuid-test' };
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
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method, body });
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/api/guide-message/subject')) return json(SUBJECT);
    if (u.includes('/api/guide-message/resolve')) {
      const t = templates.find((x) => x.id === body.templateId);
      return json({ templateId: body.templateId, language: body.lang, text: `נוסח: ${t?.nameHe}`, missingVariables: [] });
    }
    if (u.includes('/api/guide-message/send')) return json({ status: 'sent', scheduledMessageId: 'sm1', replay: false });
    if (u.includes('/api/whatsapp-templates')) return json(templates);
    return json({});
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'guideMessage.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'GuideMessageDialog.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  GuideMessageDialog = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  calls = [];
  templates = [T_DEFAULT, T_OTHER];
  document.body.innerHTML = '';
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const editor = () => document.querySelector('textarea');
const accountSelect = () => [...document.querySelectorAll('select')]
  .find((s) => [...s.options].some((o) => o.value === 'office')) || null;
const text = () => document.body.textContent;
const sends = () => calls.filter((c) => c.url.includes('/guide-message/send'));
const writes = () => calls.filter((c) => c.method !== 'GET' && c.url.includes('/whatsapp-templates'));
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

async function render() {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  await act(async () => root.render(React.createElement(GuideMessageDialog, {
    open: true, tourEventId: 'te1', reviewItemId: 'ri1', onClose: () => {}, onSent: () => {},
  })));
  await act(async () => { await sleep(120); });
  return { unmount: async () => { await act(async () => root.unmount()); mountRoot.remove(); } };
}

async function setValue(el, value) {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => { await sleep(80); });
}

test('the default template loads ITSELF — no selection click', async () => {
  const ui = await render();
  assert.equal(editor().value, 'נוסח: תודה על הסיכום', 'the composer opened already populated');
  const resolves = calls.filter((c) => c.url.includes('/guide-message/resolve'));
  assert.equal(resolves.length, 1, 'resolved exactly once');
  assert.equal(resolves[0].body.templateId, 't1');
  await ui.unmount();
});

test('the loaded message stays fully editable, and clearing it works', async () => {
  const ui = await render();
  await setValue(editor(), 'הודעה חופשית לגמרי');
  assert.equal(editor().value, 'הודעה חופשית לגמרי');
  assert.match(text(), /הודעה חופשית לגמרי/, 'the preview follows the edit');
  await setValue(editor(), '');
  assert.equal(editor().value, '', 'the operator can clear it and write from scratch');
  await ui.unmount();
});

test("the template's account is preselected and labelled as the template's", async () => {
  const ui = await render();
  assert.equal(accountSelect().value, 'office', 'שירות לקוחות, from the template — not the remembered number');
  assert.match(text(), /לפי התבנית/);
  await ui.unmount();
});

test('no default ⇒ the composer opens EMPTY (unchanged behaviour)', async () => {
  templates = [{ ...T_OTHER, isAudienceDefault: false }];
  const ui = await render();
  assert.equal(editor().value, '', 'nothing was loaded');
  assert.equal(calls.filter((c) => c.url.includes('/guide-message/resolve')).length, 0, 'and nothing was resolved');
  // Falls back to the operator's own remembered number, as before.
  assert.equal(accountSelect().value, 'main');
  await ui.unmount();
});

test('switching template reloads the wording AND re-suggests that account', async () => {
  const ui = await render();
  assert.equal(editor().value, 'נוסח: תודה על הסיכום');
  assert.equal(accountSelect().value, 'office');

  // The template picker is the shared SearchSelect: a trigger button that
  // opens a portalled listbox.
  const trigger = [...document.querySelectorAll('button[aria-haspopup="listbox"]')][0];
  assert.ok(trigger, 'the template selector is present');
  await act(async () => trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await act(async () => { await sleep(150); });

  const option = [...document.querySelectorAll('[role="option"]')]
    .find((el) => el.textContent.includes(T_OTHER.nameHe));
  assert.ok(option, 'the other template is offered');
  await act(async () => {
    option.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    option.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => { await sleep(200); });

  assert.equal(editor().value, 'נוסח: בקשת השלמה', 'the other template loaded');
  assert.equal(accountSelect().value, 'main', 'and ITS account was suggested');
  await ui.unmount();
});

test('changing the account is per-send: it rides in the send and writes NOTHING to the template', async () => {
  const ui = await render();
  await setValue(accountSelect(), 'main');
  assert.equal(accountSelect().value, 'main');
  assert.equal(writes().length, 0, 'no template was updated by changing the number');

  await act(async () => button('שליחה').dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await act(async () => { await sleep(120); });
  assert.equal(sends().length, 1);
  assert.equal(sends()[0].body.accountId, 'main', 'the ONE send used the operator’s choice');
  assert.equal(writes().length, 0, 'and the template default is untouched');
  await ui.unmount();
});

test('a retired template account is NOT swapped — warn, and block sending until chosen', async () => {
  templates = [T_RETIRED];
  const ui = await render();
  assert.equal(accountSelect().value, '', 'no number was silently substituted');
  assert.notEqual(accountSelect().value, 'office', 'the audience default did not quietly take over');
  assert.match(text(), /כבר לא זמין|לא תחליף אותו בשקט/);
  assert.equal(button('שליחה').disabled, true, 'sending is blocked until a number is chosen');
  await setValue(accountSelect(), 'office');
  assert.equal(button('שליחה').disabled, false, 'choosing one unblocks it');
  await ui.unmount();
});
