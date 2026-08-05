import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Regression smoke for direct image upload in the Variant editor's
// "תמונות בהצעה" (the URGENT library-only-picker fix): each quote position is
// ONE unified field — drag-and-drop, upload-from-computer, and library pick.
// These tests RENDER the component and prove:
//   1. the upload affordance exists even when the library is EMPTY
//      (the old UI only offered "+ מהספרייה", disabled on empty library)
//   2. drag-over activates the drop-zone state (drop wiring is live)
//   3. a picked file runs the CANONICAL path end-to-end:
//      media-files presign → PUT to R2 → MediaFile row → quoteImages.create
//      (library entity, tagged with the variant location) → attach via
//      products.setVariantQuoteImages — no product-specific upload route.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'variant-quote-images-smoke');

const VARIANT = { id: 'v1', locationId: 'loc1', quoteImageLinks: [] };

let React;
let MemoryRouter;
let createRoot;
let act;
let VariantQuoteImages;
let calls; // [{ url, method, body }]
let alerts;
let onChangedCalls;

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
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.File = window.File;
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  alerts = [];
  globalThis.alert = (msg) => alerts.push(String(msg));
  window.alert = globalThis.alert;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body || null;
    calls.push({ url: u, method, body });
    let payload = {};
    if (u.startsWith('/api/quote-images') && method === 'GET') payload = [];
    else if (u.includes('/api/media-files/presign')) {
      payload = { uploadUrl: 'http://r2.local/put-here', key: 'quote/images/k1', publicUrl: 'http://cdn.local/k1.jpg', bucket: 'b' };
    } else if (u.startsWith('http://r2.local/')) payload = {};
    else if (u.startsWith('/api/media-files')) payload = { id: 'mf1', url: 'http://cdn.local/k1.jpg' };
    else if (u.startsWith('/api/quote-images') && method === 'POST') {
      payload = { id: 'qi1', titleHe: null, titleEn: null, mediaFile: { id: 'mf1', url: 'http://cdn.local/k1.jpg' }, locationIds: body?.locationIds || [], usage: [] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'variantQuoteImages.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'VariantQuoteImages.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  VariantQuoteImages = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

async function render() {
  calls = [];
  alerts = [];
  onChangedCalls = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(VariantQuoteImages, {
          variant: VARIANT,
          slotTitles: null,
          onChanged: async () => { onChangedCalls += 1; },
        }),
      ),
    ),
  );
  await act(async () => {}); // flush the library fetch
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('every position offers direct upload even with an EMPTY library', async () => {
  const { container, unmount } = await render();
  const uploadBtns = [...container.querySelectorAll('button')].filter((b) => b.textContent.includes('העלאה מהמחשב'));
  assert.equal(uploadBtns.length, 3, 'hero + slot1 + slot2 each have an upload button');
  for (const b of uploadBtns) assert.equal(b.disabled, false, 'upload works without any library images');
  const inputs = [...container.querySelectorAll('input[type="file"]')];
  assert.equal(inputs.length, 3, 'each position has its own hidden file input (mobile click-to-upload path)');
  for (const i of inputs) assert.match(i.accept, /image\/jpeg/, 'accept list mirrors the server allowlist');
  await unmount();
});

test('drag-over activates the drop-zone state', async () => {
  const { container, unmount } = await render();
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('העלאה מהמחשב'));
  const ev = new window.Event('dragover', { bubbles: true, cancelable: true });
  ev.dataTransfer = { files: [], dropEffect: '' };
  await act(async () => { btn.dispatchEvent(ev); });
  assert.match(container.innerHTML, /שחררו/);
  await unmount();
});

test('picked file runs the canonical path: presign → R2 PUT → MediaFile → library entity → attach', async () => {
  const { container, unmount } = await render();
  const input = container.querySelector('input[type="file"]'); // hero position
  const file = new window.File(['fake-bytes'], 'tour.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await act(async () => {});

  const presign = calls.find((c) => c.url.includes('/api/media-files/presign'));
  assert.ok(presign, 'asked the canonical media-files presign');
  assert.equal(presign.body.contentType, 'image/jpeg');
  assert.ok(calls.find((c) => c.url === 'http://r2.local/put-here' && c.method === 'PUT'), 'bytes PUT straight to R2');
  const mfCreate = calls.find((c) => c.url === '/api/media-files' && c.method === 'POST');
  assert.ok(mfCreate, 'MediaFile row persisted');
  const qiCreate = calls.find((c) => c.url === '/api/quote-images' && c.method === 'POST');
  assert.ok(qiCreate, 'a REAL library entity is created (image stays reusable in the library)');
  assert.equal(qiCreate.body.mediaFileId, 'mf1');
  assert.deepEqual(qiCreate.body.locationIds, ['loc1'], 'tagged with the variant location for the default picker filter');
  const attach = calls.find((c) => c.url === '/api/products/variants/v1/quote-images' && c.method === 'PUT');
  assert.ok(attach, 'attached through the existing variant quote-images save path');
  assert.deepEqual(attach.body.positions.hero, ['qi1'], 'uploaded image selected into the hero position');
  assert.deepEqual(alerts, [], 'no error alerts during a clean upload');
  // The preview renders from variant.quoteImageLinks — the parent refetches the
  // variant via onChanged (VariantEditor's onRelationChange), so asserting the
  // refetch fired IS asserting the preview update contract.
  assert.ok(onChangedCalls >= 1, 'parent notified to refetch the variant (preview update)');
  await unmount();
});
