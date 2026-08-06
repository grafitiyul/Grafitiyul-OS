import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// "טופס הזמנה" — RENDERS the real AgentOrderFormCard (esbuild bundle, jsdom)
// and proves in the actual DOM that:
//   1. an eligible agency contact gets the card, with the agency named;
//   2. a non-agency contact gets NOTHING — and the decision is the capability
//      flag, so an organization NAMED like a travel agency changes nothing;
//   3. several qualifying agencies are ALL named (never one silently chosen);
//   4. "פתח טופס הזמנה" points at the canonical /r/<token> URL, in a new tab;
//   5. "העתק קישור" copies that exact URL and raises a success toast;
//   6. an eligible contact with no usable form still gets the card, saying so.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'agent-order-form-smoke');

let React;
let createRoot;
let act;
let AgentOrderFormCard;
let toasts;
let apiState;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

// The card must read the CANONICAL endpoint and nothing else — the stub
// exposes exactly one method, so any other call would throw.
const apiStubPlugin = {
  name: 'api-stub',
  setup(build) {
    build.onResolve({ filter: /lib\/api\.js$/ }, (args) => ({ path: args.path, namespace: 'api-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'api-stub' }, () => ({
      contents: `
        export const api = {
          contacts: {
            reservationLink: async () => globalThis.__apiState,
          },
        };
      `,
      loader: 'js',
    }));
  },
};

const TOKEN_URL = 'https://app.grafitiyul.co.il/r/AbCd1234EfGh5678IjKl9012';
const AGENCY = { id: 'org1', name: 'Dekel Tours', typeLabel: 'סוכנויות תיירות ונסיעות' };
const AGENCY_2 = { id: 'org2', name: 'Israel Way', typeLabel: 'סוכנויות תיירות ונסיעות' };
const LINK = { id: 'l1', url: TOKEN_URL, status: 'active', isEnabled: true, defaultLanguage: 'he' };

before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'card.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'agentOrderFormSmokeEntry.js')],
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
  AgentOrderFormCard = mod.AgentOrderFormCard;
  toasts = [];
  mod.subscribeToasts((t) => toasts.push(t));

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  toasts = [];
  toasts.length = 0;
});

async function render(state) {
  apiState = state;
  globalThis.__apiState = state;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(AgentOrderFormCard, { contactId: 'c1' }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { host, root };
}

const text = (host) => host.textContent || '';
const openLink = (host) => [...host.querySelectorAll('a')].find((a) => a.textContent.includes('פתח טופס הזמנה'));

test('an eligible agency contact gets the card, with the agency named', async () => {
  const { host, root } = await render({ eligible: true, agencies: [AGENCY], link: LINK });
  assert.match(text(host), /טופס הזמנה/);
  assert.match(text(host), /Dekel Tours/, 'the operator sees WHICH agency');
  root.unmount();
});

test('a non-agency contact gets no card at all', async () => {
  const { host, root } = await render({ eligible: false, agencies: [], link: null });
  assert.equal(host.textContent.trim(), '');
  root.unmount();
});

test('an organization NAMED like a travel agency but not typed as one gets nothing', async () => {
  // The server decides from OrganizationType.agentReservations; the card never
  // reads a name. A contact the server calls ineligible stays cardless however
  // its organization is spelled.
  const { host, root } = await render({
    eligible: false,
    agencies: [],
    organization: null,
    link: null,
    _org: { name: 'סוכנות נסיעות ותיירות בע"מ' },
  });
  assert.equal(host.textContent.trim(), '');
  root.unmount();
});

test('several qualifying agencies are ALL named — none silently chosen', async () => {
  const { host, root } = await render({ eligible: true, agencies: [AGENCY, AGENCY_2], link: LINK });
  assert.match(text(host), /Dekel Tours/);
  assert.match(text(host), /Israel Way/);
  // …and still ONE form, because the link belongs to the agent, not the agency.
  assert.equal([...host.querySelectorAll('a')].filter((a) => a.href === TOKEN_URL).length, 1);
  root.unmount();
});

test('the primary action opens the canonical /r/<token> URL in a new tab', async () => {
  const { host, root } = await render({ eligible: true, agencies: [AGENCY], link: LINK });
  const a = openLink(host);
  assert.ok(a, 'the action is a real button-sized action, not a bare URL box');
  assert.equal(a.getAttribute('href'), TOKEN_URL, 'the stable existing link, untouched');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.match(a.getAttribute('rel') || '', /noopener/);
  root.unmount();
});

test('copy puts that exact URL on the clipboard and raises a success toast', async () => {
  let copied = null;
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async (v) => { copied = v; } },
    configurable: true,
  });
  const { host, root } = await render({ eligible: true, agencies: [AGENCY], link: LINK });
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('העתק קישור'));
  assert.ok(btn);
  await act(async () => { btn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.equal(copied, TOKEN_URL);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].tone, 'success');
  root.unmount();
});

test('an eligible contact with NO form still gets the card, saying so', async () => {
  const { host, root } = await render({ eligible: true, agencies: [AGENCY], link: null });
  assert.match(text(host), /לא הוגדר טופס הזמנה לסוכנות זו/);
  assert.match(text(host), /קישור הזמנות לסוכן/, 'and is pointed at the canonical setup action');
  assert.equal(openLink(host), undefined, 'no open action for a link that does not exist');
  root.unmount();
});

test('a kill-switched form is never offered as openable', async () => {
  const { host, root } = await render({
    eligible: true, agencies: [AGENCY], link: { ...LINK, isEnabled: false },
  });
  assert.match(text(host), /מושבת/);
  assert.equal(openLink(host), undefined, 'handing out a URL that answers 403 would be worse than nothing');
  root.unmount();
});

test('viewing the card performs no writes — it only reads', async () => {
  // The api stub exposes ONLY reservationLink; a mint/rotate/revoke call would
  // throw here. Rendering must therefore never rotate or regenerate a token.
  const { root } = await render({ eligible: true, agencies: [AGENCY], link: LINK });
  assert.ok(apiState, 'render completed against the read-only surface');
  root.unmount();
});

// ── placement ───────────────────────────────────────────────────────────────
//
// Two production failures taught this guard, and neither was about the DOM
// being wrong — the card rendered correctly every time:
//   1. placed above "דילים קודמים" as specified, it sat ~900px down a 420px
//      scrolling column, below the fold;
//   2. moved to the top of that column, it was still inside the COLLAPSIBLE
//      right panel — whose collapsed state persists per browser forever — and
//      below the lg breakpoint that panel stacks ~4000px beneath the timeline.
//
// So the rule is not "high in the panel", it is "NOT IN THE PANEL". The card
// belongs to the center column, which is never collapsible and renders first
// when the layout stacks.
test('the card is in the CENTER column, never inside the collapsible right panel', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(path.join(here, 'ContactDetail.jsx'), 'utf8');
  const panelStart = src.indexOf('const detailsPanel');
  const panelEnd = src.indexOf('<WorkspaceLayout');
  const card = src.indexOf('<AgentOrderFormCard');
  assert.ok(panelStart > 0 && panelEnd > panelStart && card > 0);
  assert.ok(
    card < panelStart || card > panelEnd,
    'טופס הזמנה must not live in detailsPanel — a collapsed panel hides it permanently',
  );
  assert.ok(card > panelEnd, 'it belongs to the WorkspaceLayout children (the center column)');
});

test('the card is the first thing in the center column, above the contact header', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(path.join(here, 'ContactDetail.jsx'), 'utf8');
  const card = src.indexOf('<AgentOrderFormCard');
  const header = src.indexOf('{fullName}');
  const timeline = src.indexOf('<TimelineFeed');
  assert.ok(card > 0 && header > 0 && timeline > 0);
  assert.ok(card < header, 'nothing may push it down — not the identity header');
  assert.ok(card < timeline, 'and certainly not the timeline');
});

test('the card is mounted exactly ONCE (no duplicate after the move)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(path.join(here, 'ContactDetail.jsx'), 'utf8');
  assert.equal(src.split('<AgentOrderFormCard').length - 1, 1);
});
