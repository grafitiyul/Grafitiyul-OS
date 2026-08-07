import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// The reaction picker, rendered for real.
//
// The bug: the popup anchored to the ☺ button, which lives in the hover-
// revealed action cluster. The moment the pointer left the row that button
// became `hidden`, its rect collapsed to 0×0, and AnchoredMenu placed the popup
// against that — landing it in a corner of the screen, far from the message it
// belonged to. It now anchors to the BUBBLE, which is always laid out.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'reaction-picker-smoke');

let React;
let createRoot;
let act;
let MessageBubble;

// Where the bubble sits on screen. Everything else (including the hidden ☺
// button) reports 0×0 — exactly the state that produced the corner placement.
const BUBBLE_RECT = { top: 400, left: 250, right: 550, bottom: 460, width: 300, height: 60, x: 250, y: 400 };

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
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom measures nothing, so give the bubble a real rect and leave every
  // other element collapsed — the hover-hidden-button situation.
  const ZERO = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  window.Element.prototype.getBoundingClientRect = function rect() {
    return this.hasAttribute?.('data-message-bubble')
      ? { ...BUBBLE_RECT, toJSON: () => BUBBLE_RECT }
      : { ...ZERO, toJSON: () => ZERO };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'messageBubble.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'MessageBubble.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [
      {
        name: 'asset-stub',
        setup(build) {
          build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (a) => ({ path: a.path, namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
        },
      },
    ],
    outfile,
    logLevel: 'silent',
  });
  MessageBubble = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

const MESSAGE = {
  id: 'm1',
  direction: 'incoming',
  messageType: 'text',
  textContent: 'מעולה, תודה!',
  timestampFromSource: '2026-08-07T09:00:00.000Z',
  reactions: [],
};

async function mount(props = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const reacted = [];
  await act(async () => {
    root.render(
      React.createElement(MessageBubble, {
        message: MESSAGE,
        onReact: async (m, emoji) => reacted.push(emoji),
        ...props,
      }),
    );
  });
  return {
    host,
    reacted,
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
  await act(async () => {}); // let AnchoredMenu place itself
};

const reactButton = (host) => [...host.querySelectorAll('button')].find((b) => b.title === "תגובת אימוג'י");
// AnchoredMenu portals onto <body>.
const panel = () => [...document.body.children].find((el) => el.style?.position === 'fixed' && el.style.zIndex);

test('the picker opens next to the MESSAGE, not in a corner', async () => {
  const v = await mount();
  await click(reactButton(v.host));

  const p = panel();
  assert.ok(p, 'the picker is on screen');
  const top = parseFloat(p.style.top);
  const left = parseFloat(p.style.left);

  // Anchored to the bubble: it sits just under it, horizontally within reach.
  assert.ok(top >= BUBBLE_RECT.bottom && top <= BUBBLE_RECT.bottom + 16, `top ${top} hugs the bubble's bottom ${BUBBLE_RECT.bottom}`);
  assert.ok(
    left + 260 >= BUBBLE_RECT.left && left <= BUBBLE_RECT.right + 8,
    `left ${left} overlaps the bubble's horizontal span`,
  );
  // The failure mode this replaces: placed against a 0×0 rect at the origin.
  assert.ok(top > 50, 'not pinned to the top of the viewport');
  await v.unmount();
});

test('the quick row carries the common reactions plus a "+"', async () => {
  const v = await mount();
  await click(reactButton(v.host));
  const buttons = [...panel().querySelectorAll('button')];
  const labels = buttons.map((b) => b.textContent);
  for (const emoji of ['👍', '❤️', '😂']) {
    assert.ok(labels.includes(emoji), `${emoji} is in the quick row`);
  }
  assert.ok(labels.includes('+'), 'and WhatsApp\'s "+" for everything else');
  await v.unmount();
});

test('picking from the quick row reacts and closes', async () => {
  const v = await mount();
  await click(reactButton(v.host));
  const thumb = [...panel().querySelectorAll('button')].find((b) => b.textContent === '👍');
  await click(thumb);
  assert.deepEqual(v.reacted, ['👍']);
  assert.equal(panel(), undefined, 'the popup closed');
  await v.unmount();
});

test('"+" swaps the quick row for the full catalog, in the same anchored popup', async () => {
  const v = await mount();
  await click(reactButton(v.host));
  const plus = [...panel().querySelectorAll('button')].find((b) => b.textContent === '+');
  await click(plus);

  const p = panel();
  assert.ok(p, 'still one popup, still anchored');
  assert.ok(!p.textContent.includes('+'), 'the quick row gave way to the picker');
  assert.match(p.textContent, /טוען אימוג׳ים|/, 'the shared picker panel mounted');
  // Still attached to the message, not relocated.
  assert.ok(parseFloat(p.style.top) >= BUBBLE_RECT.bottom - 400, 'placement still derives from the bubble');
  await v.unmount();
});

test('clicking my own reaction again removes it (empty emoji)', async () => {
  const v = await mount({
    message: { ...MESSAGE, reactions: [{ emoji: '👍', mine: true, reactorPhone: '972500000000' }] },
  });
  const chip = [...v.host.querySelectorAll('button')].find((b) => b.textContent.startsWith('👍'));
  await click(chip);
  assert.deepEqual(v.reacted, [''], 'an empty emoji is the removal');
  await v.unmount();
});

test('a received reaction renders with who sent it', async () => {
  const v = await mount({
    message: {
      ...MESSAGE,
      reactions: [
        { emoji: '❤️', mine: false, reactorName: 'דנה', reactorPhone: '972501112222' },
        { emoji: '❤️', mine: false, reactorName: 'יובל', reactorPhone: '972503334444' },
      ],
    },
  });
  const chip = [...v.host.querySelectorAll('button')].find((b) => b.textContent.startsWith('❤️'));
  assert.ok(chip, 'the reaction chip is under the bubble');
  assert.match(chip.textContent, /2/, 'counted');
  assert.equal(chip.title, 'דנה, יובל', 'and attributed');
  await v.unmount();
});
