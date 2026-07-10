import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// UX refinement smoke — multi-select renders as a VERTICAL CHECKBOX LIST
// (native checkboxes = GOS idiom; keyboard + screen-reader semantics for
// free), while single choice keeps its pills. Presentation only — the answer
// model (string[] + __other__: sentinel) is untouched, proven by driving the
// real inputs and asserting onChange payloads.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'multicheckbox-smoke');

const L = (he) => ({ he });

const RUNTIME = {
  template: {
    id: 'tpl1', key: 'mc', purpose: 'general',
    title: L('טופס'), description: null, audience: 'both',
    defaultLanguage: 'he', supportedLanguages: ['he'],
  },
  version: { id: 'ver1', versionNo: 1, status: 'draft', displayMode: 'full_list', intro: null, outro: null },
  sections: [
    {
      id: 'sec1', key: 's_a', title: L('העדפות'), description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        {
          id: 'q1', key: 'q_langs', type: 'multi', label: L('שפות מועדפות'), helpText: null, placeholder: null,
          required: false, config: { allowOther: true }, visibleWhen: null,
          options: [
            { id: 'o1', value: 'he', label: L('עברית') },
            { id: 'o2', value: 'en', label: L('אנגלית') },
            { id: 'o3', value: 'es', label: L('ספרדית') },
          ],
        },
        {
          id: 'q2', key: 'q_kind', type: 'choice', label: L('סוג פעילות'), helpText: null, placeholder: null,
          required: false, config: null, visibleWhen: null,
          options: [
            { id: 'o4', value: 'tour', label: L('סיור') },
            { id: 'o5', value: 'workshop', label: L('סדנה') },
          ],
        },
      ],
    },
  ],
};

let React;
let createRoot;
let act;
let QuestionnaireRuntime;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

async function bundle(esbuild, entry) {
  const outfile = path.join(cacheDir, `${path.basename(entry, '.jsx')}.bundle.mjs`);
  await esbuild.build({
    entryPoints: [path.join(here, entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  return (await import(pathToFileURL(outfile).href)).default;
}

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' });

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  QuestionnaireRuntime = await bundle(esbuild, '../../questionnaire/QuestionnaireRuntime.jsx');

  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
});

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await act(async () => {});
  return { container, unmount: () => act(async () => root.unmount()) };
}

test('multi renders REAL checkboxes in a vertical group; single choice keeps pills', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: RUNTIME,
      language: 'he',
      initialAnswers: { q_langs: ['he'] },
      onSubmit: async () => {},
    }),
  );
  const multiRow = container.querySelector('[data-qkey="q_langs"]');
  const boxes = multiRow.querySelectorAll('input[type="checkbox"]');
  assert.equal(boxes.length, 4, '3 options + "אחר…" as checkboxes');
  assert.ok(multiRow.querySelector('[role="group"]'), 'checkbox group semantics');
  assert.equal(multiRow.querySelector('[role="group"]').getAttribute('aria-label'), 'שפות מועדפות');
  // Green accent (GOS native-checkbox idiom) + selected state on the input.
  assert.match(boxes[0].className, /accent-emerald-600/);
  assert.equal(boxes[0].checked, true); // he preselected
  assert.equal(boxes[1].checked, false);
  // Whole row is a <label> wrapping the input → clicking anywhere toggles,
  // and every row meets the mobile tap-target height.
  assert.equal(boxes[0].closest('label').tagName, 'LABEL');
  assert.match(boxes[0].closest('label').className, /min-h-\[44px\]/);
  // The row must NOT go blue — selected style is the subtle emerald wash.
  assert.doesNotMatch(boxes[0].closest('label').className, /bg-blue/);
  assert.match(boxes[0].closest('label').className, /bg-emerald-50\/50/);

  // Single choice is untouched: pills (buttons), zero checkboxes.
  const choiceRow = container.querySelector('[data-qkey="q_kind"]');
  assert.equal(choiceRow.querySelectorAll('input[type="checkbox"]').length, 0);
  assert.ok([...choiceRow.querySelectorAll('button')].some((b) => b.textContent.includes('סיור')));
  await unmount();
});

test('toggling checkboxes preserves the answer model (string[] + __other__ sentinel)', async () => {
  let latest;
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: RUNTIME,
      language: 'he',
      initialAnswers: { q_langs: ['he'] },
      onChange: (answers) => { latest = answers; },
      onSubmit: async () => {},
    }),
  );
  const multiRow = container.querySelector('[data-qkey="q_langs"]');
  const boxes = () => multiRow.querySelectorAll('input[type="checkbox"]');

  // Check "אנגלית" → value grows.
  await act(async () => boxes()[1].click());
  assert.deepEqual(latest.q_langs, ['he', 'en']);

  // Check "אחר…" → sentinel token joins; free-text input appears and types.
  await act(async () => boxes()[3].click());
  assert.ok(latest.q_langs.some((v) => v.startsWith('__other__:')));
  const other = multiRow.querySelector('input:not([type="checkbox"])');
  assert.ok(other, 'free-text field appears');

  // Uncheck "עברית" → removed; unchecking everything clears the answer.
  await act(async () => boxes()[0].click());
  assert.ok(!latest.q_langs.includes('he'));
  await unmount();
});
