import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Toast wiring, end to end: an emit from lib/toast.js must reach the RENDERED
// ToastHost. The production failure mode this guards is silent — no error, no
// alert, just no feedback — so the test bundles the host and the emitter
// TOGETHER (one module instance, exactly like the app bundle) and asserts the
// text actually lands in the DOM.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'toast-smoke');

let React;
let createRoot;
let act;
let mod; // { ToastHost, showToast, showErrorToast }

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
  const outfile = path.join(cacheDir, 'toast.bundle.mjs');
  await esbuild.build({
    // ONE entry re-exporting both, so host and emitter share a module instance
    // — a duplicated instance is precisely how a toast goes missing.
    stdin: {
      contents:
        "export { default as ToastHost } from './ToastHost.jsx';\n"
        + "export { showToast, showErrorToast } from '../lib/toast.js';\n",
      resolveDir: here,
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    outfile,
    logLevel: 'silent',
  });
  mod = await import(pathToFileURL(outfile).href);

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function mountHost() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(mod.ToastHost)));
  await act(async () => {});
  return { container, root };
}

test('a success emit reaches the rendered host', async () => {
  const { container } = await mountHost();
  await act(async () => {
    mod.showToast('מייל האישור נכנס לתור השליחה', 'המייל יישלח בקרוב');
  });
  assert.match(container.textContent, /מייל האישור נכנס לתור השליחה/);
  assert.match(container.textContent, /המייל יישלח בקרוב/, 'the second line renders too');
});

test('it is dismissible with ×', async () => {
  const { container } = await mountHost();
  await act(async () => { mod.showToast('נשלח'); });
  const close = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('×'));
  assert.ok(close, 'a × button must exist');
  await act(async () => { close.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.doesNotMatch(container.textContent, /נשלח/);
});

test('it survives an unrelated unmount — closing the preview must not clear it', async () => {
  const { container } = await mountHost();
  // A separate tree stands in for the modal that closes right after sending.
  const modalBox = document.createElement('div');
  document.body.appendChild(modalBox);
  const modalRoot = createRoot(modalBox);
  await act(async () => modalRoot.render(React.createElement('div', null, 'modal')));

  await act(async () => { mod.showToast('מייל האישור נכנס לתור השליחה'); });
  await act(async () => modalRoot.unmount()); // preview closes

  assert.match(container.textContent, /מייל האישור נכנס לתור השליחה/, 'the toast lives in the shell, not the modal');
});

test('errors use the SAME channel (never a native alert)', async () => {
  const { container } = await mountHost();
  await act(async () => { mod.showErrorToast('שגיאה בשליחה'); });
  assert.match(container.textContent, /שגיאה בשליחה/);
});

test('two sends produce two independent toasts', async () => {
  const { container } = await mountHost();
  await act(async () => {
    mod.showToast('ראשון');
    mod.showToast('שני');
  });
  assert.match(container.textContent, /ראשון/);
  assert.match(container.textContent, /שני/);
});
