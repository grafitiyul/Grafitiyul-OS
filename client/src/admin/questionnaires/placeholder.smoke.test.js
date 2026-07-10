import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Placeholder ("טקסט לדוגמה בתוך השדה") smoke — same harness as the other
// questionnaire smoke tests (jsdom + esbuild + route-aware fetch stub):
//   • runtime renders the localized placeholder INSIDE text/textarea/number
//     inputs; helpText renders in its own paragraph — two separate locations
//   • language fallback: en missing → default-language text
//   • unsupported types (choice/yesno) never surface a placeholder
//   • legacy questions with placeholder:null keep working (empty attribute)
//   • the placeholder is never part of the submitted answers
//   • builder: the field appears for free-input types only, round-trips the
//     saved value, and edits PUT a localized map to the question endpoint

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'placeholder-smoke');

const PH_COMPANY_HE = 'לדוגמה: חברת ישראל בע״מ';
const PH_COMPANY_EN = 'e.g. Israel Ltd';
const PH_NOTES_HE = 'פרטים נוספים על האירוע';
const PH_COUNT_HE = 'לדוגמה: 25';
const PH_BAD = 'טקסט שאסור שיופיע';

const RUNTIME = {
  template: {
    id: 'tpl1', key: 'ph', purpose: 'general',
    title: { he: 'שאלון', en: 'Form' }, description: null, audience: 'both',
    defaultLanguage: 'he', supportedLanguages: ['he', 'en'],
  },
  version: {
    id: 'ver1', versionNo: 1, status: 'draft', displayMode: 'full_list',
    intro: null, outro: null,
  },
  sections: [
    {
      id: 'sec1', key: 's_a', title: { he: 'פרטים', en: 'Details' }, description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        {
          id: 'q1', key: 'q_company', type: 'text',
          label: { he: 'שם החברה', en: 'Company name' },
          helpText: { he: 'נא לכתוב את השם הרשמי', en: 'Official name please' },
          placeholder: { he: PH_COMPANY_HE, en: PH_COMPANY_EN },
          required: false, config: null, visibleWhen: null, options: [],
        },
        // placeholder set in he only → en runtime must FALL BACK, never blank
        {
          id: 'q2', key: 'q_notes', type: 'textarea',
          label: { he: 'הערות', en: 'Notes' }, helpText: null,
          placeholder: { he: PH_NOTES_HE },
          required: false, config: null, visibleWhen: null, options: [],
        },
        {
          id: 'q3', key: 'q_count', type: 'number',
          label: { he: 'מספר משתתפים', en: 'Participants' }, helpText: null,
          placeholder: { he: PH_COUNT_HE },
          required: false, config: null, visibleWhen: null, options: [],
        },
        // legacy question predating the field
        {
          id: 'q4', key: 'q_old', type: 'text',
          label: { he: 'שדה ישן', en: 'Old field' }, helpText: null, placeholder: null,
          required: false, config: null, visibleWhen: null, options: [],
        },
        // unsupported types — placeholder set on purpose; must never render
        {
          id: 'q5', key: 'q_kind', type: 'choice',
          label: { he: 'סוג פעילות', en: 'Kind' }, helpText: null,
          placeholder: { he: PH_BAD },
          required: false, config: null, visibleWhen: null,
          options: [
            { id: 'o1', value: 'tour', label: { he: 'סיור', en: 'Tour' } },
            { id: 'o2', value: 'workshop', label: { he: 'סדנה', en: 'Workshop' } },
          ],
        },
        {
          id: 'q6', key: 'q_vip', type: 'yesno',
          label: { he: 'אירוע מיוחד?', en: 'Special?' }, helpText: null,
          placeholder: { he: PH_BAD },
          required: false, config: null, visibleWhen: null, options: [],
        },
      ],
    },
  ],
};

const TEMPLATE_DETAIL = {
  id: 'tpl1', key: 'ph', purpose: 'general', internalName: 'שאלון פלייסהולדר',
  title: RUNTIME.template.title, status: 'draft', audience: 'both',
  defaultLanguage: 'he', supportedLanguages: ['he', 'en'],
  singletonPerSubject: false, currentVersionId: null, currentVersion: null,
  versions: [{ id: 'ver1', versionNo: 1, status: 'draft', publishedAt: null, notes: null, updatedAt: '2026-07-10T10:00:00Z' }],
  _count: { submissions: 0 },
};

const fetchCalls = [];

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let QuestionnaireRuntime;
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

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    let body;
    if (u.startsWith('/api/questionnaires/purposes')) body = { questionTypes: [], purposes: [] };
    else if (u.startsWith('/api/questionnaires/versions/ver1')) body = RUNTIME;
    else if (u.startsWith('/api/questionnaires/questions/')) body = { ok: true };
    else if (u.startsWith('/api/questionnaires/tpl1')) body = TEMPLATE_DETAIL;
    else body = [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  QuestionnaireRuntime = await bundle(esbuild, '../../questionnaire/QuestionnaireRuntime.jsx');
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

// React controlled inputs: set via the native setter, then fire 'input'.
async function type(el, text) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

test('runtime HE: placeholder inside the input, helpText in its own paragraph', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he' }),
  );
  assert.ok(container.querySelector(`input[placeholder="${PH_COMPANY_HE}"]`), 'text input carries placeholder');
  assert.ok(container.querySelector(`textarea[placeholder="${PH_NOTES_HE}"]`), 'textarea carries placeholder');
  assert.ok(container.querySelector(`input[type="number"][placeholder="${PH_COUNT_HE}"]`), 'number input carries placeholder');
  // helpText renders as visible TEXT below the label…
  assert.match(container.textContent, /נא לכתוב את השם הרשמי/);
  // …while the placeholder is attribute-only: never part of the visible text.
  assert.doesNotMatch(container.textContent, new RegExp(PH_COMPANY_HE));
  await unmount();
});

test('runtime EN: localized placeholder + default-language fallback', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'en' }),
  );
  assert.ok(container.querySelector(`input[placeholder="${PH_COMPANY_EN}"]`), 'en placeholder used');
  // q_notes has no en placeholder → falls back to he (never blank).
  assert.ok(container.querySelector(`textarea[placeholder="${PH_NOTES_HE}"]`), 'fallback to default language');
  await unmount();
});

test('unsupported types never surface a placeholder; legacy null stays empty', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he' }),
  );
  assert.equal(container.querySelectorAll(`[placeholder="${PH_BAD}"]`).length, 0, 'choice/yesno render no placeholder');
  assert.doesNotMatch(container.innerHTML, new RegExp(PH_BAD));
  // legacy question renders a plain input with an empty placeholder attribute
  const inputs = [...container.querySelectorAll('input[type="text"], input:not([type])')];
  assert.ok(inputs.some((i) => (i.getAttribute('placeholder') || '') === ''), 'legacy input works without placeholder');
  await unmount();
});

test('placeholder is never stored as an answer', async () => {
  let submitted = null;
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: RUNTIME, language: 'he',
      submitLabel: 'שליחה סופית',
      onSubmit: async (answers) => { submitted = answers; },
    }),
  );
  const submitBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('שליחה סופית'));

  // Untouched form → empty answers, no placeholder leakage.
  await click(submitBtn);
  assert.deepEqual(submitted, {});

  // Typing replaces the placeholder; only the TYPED value is submitted.
  const companyInput = container.querySelector(`input[placeholder="${PH_COMPANY_HE}"]`);
  await type(companyInput, 'גרפיטיול בע״מ');
  await click(submitBtn);
  assert.deepEqual(submitted, { q_company: 'גרפיטיול בע״מ' });
  await unmount();
});

test('builder: field shown for free-input types, round-trips value, saves a localized map', async () => {
  fetchCalls.length = 0;
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/admin/questionnaires/tpl1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/admin/questionnaires/:id', element: React.createElement(QuestionnaireBuilderPage) }))),
  );

  // Open the text question → the placeholder field appears, loaded with the saved value.
  const companyRow = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('שם החברה'));
  await click(companyRow);
  assert.match(container.textContent, /טקסט לדוגמה בתוך השדה/);
  const phInput = [...container.querySelectorAll('input')].find((i) => i.value === PH_COMPANY_HE);
  assert.ok(phInput, 'saved placeholder reloads into the editor field');

  // Editing + blur saves a LOCALIZED MAP via the question endpoint.
  await type(phInput, 'טקסט חדש לדוגמה');
  await act(async () => {
    phInput.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
  });
  const put = fetchCalls.find((c) => c.method === 'PUT' && c.url === '/api/questionnaires/questions/q1');
  assert.ok(put, 'placeholder edit PUTs the question');
  assert.deepEqual(JSON.parse(put.body).placeholder, { he: 'טקסט חדש לדוגמה', en: PH_COMPANY_EN });

  // Close, open a CHOICE question → no placeholder field.
  await click(container.querySelector('button[aria-label="סגירה"]'));
  const choiceRow = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('סוג פעילות'));
  await click(choiceRow);
  assert.match(container.textContent, /הגדרות שאלה/);
  assert.doesNotMatch(container.textContent, /טקסט לדוגמה בתוך השדה/);
  await unmount();
});
