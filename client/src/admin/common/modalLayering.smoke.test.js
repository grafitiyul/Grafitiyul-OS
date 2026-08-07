import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { dialogZ, PANE_MAX_Z } from './floatingLayerCore.js';

// The production defect, reproduced in the DOM: open a Deal from a WhatsApp
// conversation, generate a Quote, and the preview's footer buttons were hidden
// behind the WhatsApp frame.
//
// Two things caused it, and both are asserted here:
//   1. The Deal drawer animates with `translate-x`. A transform makes an
//      element the containing block for `position: fixed` DESCENDANTS, so the
//      dialog's `fixed inset-0` stopped meaning "the viewport" and started
//      meaning "the drawer" — then the drawer's `overflow-hidden` clipped it.
//   2. Dialogs sat at z-50, below the z-[60] drawer.
//
// So a dialog must be a child of <body> no matter what it is rendered inside,
// and it must outrank every drawer/pane.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'modal-layering-smoke');

let React;
let createRoot;
let act;
let Dialog;

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'dialog.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'Dialog.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    outfile,
    logLevel: 'silent',
  });
  Dialog = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

// A stand-in for the Deal drawer as it actually renders: absolutely positioned
// inside its pane, clipped, and TRANSFORMED by its slide-in transition.
function Drawer({ children }) {
  return React.createElement(
    'div',
    {
      'data-drawer': 'true',
      className: 'absolute inset-0 z-[60] overflow-hidden',
      style: { transform: 'translateX(0)', overflow: 'hidden', position: 'absolute' },
    },
    children,
  );
}

async function mountDialogInsideDrawer() {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  await act(async () => {
    root.render(
      React.createElement(
        Drawer,
        null,
        React.createElement(
          Dialog,
          { open: true, onClose: () => {}, title: 'תצוגת הצעת מחיר', footer: React.createElement('button', null, 'אישור') },
          React.createElement('div', null, 'תוכן ההצעה'),
        ),
      ),
    );
  });
  return {
    mountRoot,
    unmount: async () => {
      await act(async () => root.unmount());
      mountRoot.remove();
    },
  };
}

const overlay = () => document.body.querySelector('[role="dialog"][aria-modal="true"]');

test('a dialog opened inside a transformed drawer escapes it entirely', async () => {
  const { mountRoot, unmount } = await mountDialogInsideDrawer();

  const panel = overlay();
  assert.ok(panel, 'the dialog rendered');
  assert.equal(panel.parentElement, document.body, 'portaled straight onto <body>');
  assert.ok(!mountRoot.contains(panel), 'and NOT inside the drawer that opened it');

  // No transformed/clipping ancestor is left between it and the viewport.
  const drawer = mountRoot.querySelector('[data-drawer]');
  assert.ok(drawer, 'the drawer is really there (the test would be vacuous otherwise)');
  assert.ok(!drawer.contains(panel), 'the drawer cannot clip what it does not contain');

  await unmount();
});

test('the dialog outranks the drawer it was opened from', async () => {
  const { unmount } = await mountDialogInsideDrawer();
  assert.equal(Number(overlay().style.zIndex), dialogZ(0));
  assert.ok(dialogZ(0) > 60, 'above the z-[60] drawer');
  await unmount();
});

test('the footer actions are inside the portaled panel, reachable', async () => {
  // "The buttons at the bottom can be hidden behind the WhatsApp frame" was the
  // reported symptom — the footer must ride along with the escaped panel.
  const { unmount } = await mountDialogInsideDrawer();
  const footerButton = [...overlay().querySelectorAll('button')].find((b) => b.textContent === 'אישור');
  assert.ok(footerButton, 'the footer action is in the dialog');
  assert.equal(document.body.contains(footerButton), true);
  await unmount();
});

test('the panel caps its height so a tall dialog scrolls internally', async () => {
  const { unmount } = await mountDialogInsideDrawer();
  const inner = overlay().querySelector('[dir="rtl"]');
  assert.equal(inner.style.maxHeight, '90vh', 'body scrolls inside instead of running off-screen');
  await unmount();
});

test('no drawer or pane in the codebase claims a z above the modal layer', async () => {
  // A static guard: the fix is only durable if panes stay under the ceiling.
  const drawerSrc = readFileSync(path.join(here, 'DealDrawer.jsx'), 'utf8');
  const zs = [...drawerSrc.matchAll(/\bz-\[(\d+)\]/g)].map((m) => Number(m[1]));
  assert.ok(zs.length > 0, 'the drawer does declare z-indexes');
  for (const z of zs) {
    assert.ok(z <= PANE_MAX_Z, `DealDrawer z-[${z}] must stay at or below the pane ceiling ${PANE_MAX_Z}`);
    assert.ok(z < dialogZ(0), `DealDrawer z-[${z}] must stay below the modal layer ${dialogZ(0)}`);
  }
});
