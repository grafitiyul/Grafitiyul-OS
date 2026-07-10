import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Slice 4 smoke — full multilingual support:
//   • runtime renders English labels + English engine chrome (yes/no,
//     choose…) with LTR direction; Hebrew stays RTL
//   • fallback: missing en translation falls back to the default language
//   • public page shows the language switcher when >1 supported language
//   • builder shows the editing-language tabs + missing-translation dot
// Plus the shared localized helpers' behavior is covered by server unit tests.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'multilingual-smoke');

const RUNTIME = {
  template: {
    id: 'tpl1', key: 'ml', purpose: 'coordination',
    title: { he: 'שיחת תיאום', en: 'Coordination call' },
    description: null, audience: 'public',
    defaultLanguage: 'he', supportedLanguages: ['he', 'en'],
  },
  version: {
    id: 'ver1', versionNo: 2, status: 'draft', displayMode: 'full_list',
    intro: null, outro: { he: 'תודה!', en: 'Thank you!' },
  },
  sections: [
    {
      id: 'sec1', key: 's_a', title: { he: 'פרטים', en: 'Details' }, description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        { id: 'q1', key: 'q_name', type: 'text', label: { he: 'שם מלא', en: 'Full name' }, helpText: null, placeholder: null, required: true, config: null, visibleWhen: null, options: [] },
        // en missing on purpose → fallback to he everywhere + builder dot
        { id: 'q2', key: 'q_notes', type: 'textarea', label: { he: 'הערות' }, helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q3', key: 'q_vip', type: 'yesno', label: { he: 'אירוע מיוחד?', en: 'Special event?' }, helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        {
          id: 'q4', key: 'q_kind', type: 'dropdown', label: { he: 'סוג', en: 'Kind' }, helpText: null, placeholder: null, required: false,
          config: null, visibleWhen: null,
          options: [{ id: 'o1', value: 'tour', label: { he: 'סיור', en: 'Tour' } }],
        },
      ],
    },
  ],
};

const TEMPLATE_DETAIL = {
  id: 'tpl1', key: 'ml', purpose: 'coordination', internalName: 'שאלון דו-לשוני',
  title: RUNTIME.template.title, status: 'draft', audience: 'public',
  defaultLanguage: 'he', supportedLanguages: ['he', 'en'],
  singletonPerSubject: true, currentVersionId: null, currentVersion: null,
  versions: [{ id: 'ver1', versionNo: 2, status: 'draft', publishedAt: null, notes: null, updatedAt: '2026-07-10T10:00:00Z' }],
  _count: { submissions: 0 },
};

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let QuestionnaireRuntime;
let PublicFormPage;
let QuestionnaireBuilderPage;

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

  globalThis.fetch = async (url) => {
    const u = String(url);
    let body;
    if (u.startsWith('/api/public/form/tokml')) {
      body = {
        status: 'draft', language: 'en',
        subject: { title: 'Cohen family', subtitle: 'Graffiti tour · 2026-08-06' },
        runtime: RUNTIME, answers: {}, prefill: {}, submittedAt: null, outroOnly: false,
      };
    } else if (u.startsWith('/api/questionnaires/purposes')) {
      body = { questionTypes: [], purposes: [] };
    } else if (u.startsWith('/api/questionnaires/versions/ver1')) {
      body = RUNTIME;
    } else if (u.startsWith('/api/questionnaires/tpl1')) {
      body = TEMPLATE_DETAIL;
    } else {
      body = [];
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  QuestionnaireRuntime = await bundle(esbuild, '../../questionnaire/QuestionnaireRuntime.jsx');
  PublicFormPage = await bundle(esbuild, '../../questionnaire/PublicFormPage.jsx');
  QuestionnaireBuilderPage = await bundle(esbuild, 'QuestionnaireBuilderPage.jsx');

  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
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

test('runtime in ENGLISH: labels, engine chrome (Yes/No, Choose…), LTR dir, he-fallback', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'en' }),
  );
  const html = container.innerHTML;
  assert.match(html, /Full name/); // localized label
  assert.match(html, /Details/); // localized section title
  assert.match(html, /Yes/); // engine chrome localized
  assert.match(html, /No</);
  assert.match(html, /Choose…/); // dropdown placeholder
  assert.match(html, /הערות/); // en missing → falls back to he, never blank
  assert.equal(container.querySelector('[dir="ltr"]') !== null, true, 'root is LTR');
  await unmount();
});

test('runtime in HEBREW: RTL dir + Hebrew chrome', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he' }),
  );
  assert.match(container.innerHTML, /שם מלא/);
  assert.match(container.innerHTML, /כן/);
  assert.equal(container.querySelector('[dir="rtl"]') !== null, true, 'root is RTL');
  await unmount();
});

test('public page: language switcher renders and the page follows the link language (en → LTR)', async () => {
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/form/tokml'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/form/:token', element: React.createElement(PublicFormPage) }))),
  );
  const html = container.innerHTML;
  assert.match(html, /Coordination call/); // en title (link language)
  assert.match(html, /עברית/); // switcher offers Hebrew
  assert.match(html, /English/);
  assert.equal(container.querySelector('[dir="ltr"]') !== null, true);
  await unmount();
});

test('builder: editing-language tabs with a missing-translation indicator', async () => {
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/admin/questionnaires/tpl1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/admin/questionnaires/:id', element: React.createElement(QuestionnaireBuilderPage) }))),
  );
  const html = container.innerHTML;
  assert.match(html, /שפת עריכה/); // the tab bar label
  assert.match(html, /English/); // en tab
  assert.match(html, /שפות הטופס/); // supported-languages editor
  // q_notes lacks en → the en tab carries the amber missing dot.
  assert.match(html, /חסרים תרגומים בשפה זו/);
  await unmount();
});
