import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Render SMOKE tests for the Questionnaire Engine client — same harness as
// toursPage.smoke.test.js (jsdom + esbuild bundling + route-aware fetch stub):
//   • template list: empty + populated states
//   • builder: sections, questions, type chips, publish button on a draft
//   • fill runtime: every Slice-1 question type renders; conditional
//     visibility hides/shows via the SHARED evaluator; required indicator
//   • preview page: badge + no-save submit flow

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'questionnaires-smoke');

const L = (he) => ({ he });

const RUNTIME = {
  template: {
    id: 'tpl1', key: 'demo', purpose: 'general',
    title: L('שאלון בדיקה'), description: null, audience: 'both',
    defaultLanguage: 'he', supportedLanguages: ['he'],
  },
  version: {
    id: 'ver1', versionNo: 1, status: 'draft', displayMode: 'full_list',
    intro: L('<p>ברוכים הבאים לשאלון</p>'), outro: L('תודה רבה!'),
  },
  sections: [
    {
      id: 'sec1', key: 's_a', title: L('פרטים'), description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        { id: 'q1', key: 'q_name', type: 'text', label: L('שם מלא'), helpText: L('כפי שמופיע בתעודה'), placeholder: null, required: true, config: null, visibleWhen: null, options: [] },
        { id: 'q2', key: 'q_notes', type: 'textarea', label: L('הערות'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q3', key: 'q_count', type: 'number', label: L('מספר משתתפים'), helpText: null, placeholder: null, required: false, config: { min: 1 }, visibleWhen: null, options: [] },
        { id: 'q4', key: 'q_email', type: 'email', label: L('אימייל'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q5', key: 'q_phone', type: 'phone', label: L('טלפון'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q6', key: 'q_url', type: 'url', label: L('אתר'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q7', key: 'q_date', type: 'date', label: L('תאריך הגעה'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q8', key: 'q_time', type: 'time', label: L('שעת הגעה'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q9', key: 'q_dt', type: 'datetime', label: L('מועד מדויק'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q10', key: 'q_vip', type: 'yesno', label: L('אירוע VIP?'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
      ],
    },
    {
      id: 'sec2', key: 's_b', title: L('העדפות'), description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        {
          id: 'q11', key: 'q_kind', type: 'choice', label: L('סוג פעילות'), helpText: null, placeholder: null, required: false,
          config: { allowOther: true }, visibleWhen: null,
          options: [
            { id: 'o1', value: 'tour', label: L('סיור') },
            { id: 'o2', value: 'workshop', label: L('סדנה') },
          ],
        },
        {
          id: 'q12', key: 'q_workshop_type', type: 'dropdown', label: L('איזו סדנה?'), helpText: null, placeholder: null, required: true,
          config: null, visibleWhen: { q: 'q_kind', op: 'eq', value: 'workshop' },
          options: [
            { id: 'o3', value: 'records', label: L('תקליטים') },
            { id: 'o4', value: 'wall', label: L('ציור קיר') },
          ],
        },
        {
          id: 'q13', key: 'q_langs', type: 'multi', label: L('שפות מועדפות'), helpText: null, placeholder: null, required: false,
          config: null, visibleWhen: null,
          options: [
            { id: 'o5', value: 'he', label: L('עברית') },
            { id: 'o6', value: 'en', label: L('אנגלית') },
          ],
        },
        { id: 'q14', key: 'q_scale', type: 'scale', label: L('שביעות רצון צפויה'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q15', key: 'q_rating', type: 'rating', label: L('דירוג'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q16', key: 'q_slider', type: 'slider', label: L('תקציב'), helpText: null, placeholder: null, required: false, config: { max: 200 }, visibleWhen: null, options: [] },
        { id: 'q17', key: 'q_static', type: 'static_text', label: L('<strong>שימו לב:</strong> הפרטים חסויים'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
      ],
    },
  ],
};

const TEMPLATE_DETAIL = {
  id: 'tpl1', key: 'demo', purpose: 'general', internalName: 'שאלון בדיקה',
  title: L('שאלון בדיקה'), status: 'draft', audience: 'both',
  defaultLanguage: 'he', supportedLanguages: ['he'],
  singletonPerSubject: false, currentVersionId: null, currentVersion: null,
  versions: [{ id: 'ver1', versionNo: 1, status: 'draft', publishedAt: null, notes: null, updatedAt: '2026-07-10T10:00:00Z' }],
  _count: { submissions: 0 },
};

const PURPOSES = {
  questionTypes: ['text', 'textarea', 'number', 'choice'],
  purposes: [
    { key: 'tour_summary', labelHe: 'סיכום סיור', subjectTypes: ['tour_event'], audience: 'staff', singleton: true, config: null },
    { key: 'coordination', labelHe: 'שיחת תיאום', subjectTypes: ['booking'], audience: 'public', singleton: true, config: null },
    { key: 'general', labelHe: 'כללי', subjectTypes: [], audience: 'both', singleton: false, config: null },
  ],
};

let templatesList = [];

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let QuestionnairesPage;
let QuestionnaireBuilderPage;
let QuestionnairePreviewPage;
let QuestionnaireRuntime;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({
      path: args.path,
      namespace: 'asset-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({
      contents: 'export default "";',
      loader: 'js',
    }));
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
    if (u.startsWith('/api/questionnaires/purposes')) body = PURPOSES;
    else if (u.startsWith('/api/questionnaires/versions/ver1')) body = RUNTIME;
    else if (u.startsWith('/api/questionnaires/tpl1')) body = TEMPLATE_DETAIL;
    else if (u.startsWith('/api/questionnaires')) body = templatesList;
    else body = [];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  QuestionnairesPage = await bundle(esbuild, 'QuestionnairesPage.jsx');
  QuestionnaireBuilderPage = await bundle(esbuild, 'QuestionnaireBuilderPage.jsx');
  QuestionnairePreviewPage = await bundle(esbuild, 'QuestionnairePreviewPage.jsx');
  QuestionnaireRuntime = await bundle(esbuild, '../../questionnaire/QuestionnaireRuntime.jsx');

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
  return {
    container,
    unmount: () => act(async () => root.unmount()),
  };
}

test('templates list renders the empty state', async () => {
  templatesList = [];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(QuestionnairesPage)),
  );
  assert.match(container.innerHTML, /אין שאלונים עדיין/);
  assert.match(container.innerHTML, /שאלון חדש/);
  await unmount();
});

test('templates list renders a populated row with purpose + version info', async () => {
  templatesList = [TEMPLATE_DETAIL];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(QuestionnairesPage)),
  );
  assert.match(container.innerHTML, /שאלון בדיקה/);
  assert.match(container.innerHTML, /כללי/);
  assert.match(container.innerHTML, /אין גרסה מפורסמת/);
  await unmount();
});

test('builder renders sections, questions, type chips and the publish button', async () => {
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/admin/questionnaires/tpl1'] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/admin/questionnaires/:id',
          element: React.createElement(QuestionnaireBuilderPage),
        }),
      ),
    ),
  );
  const html = container.innerHTML;
  assert.match(html, /פרטים/); // section 1 title
  assert.match(html, /העדפות/); // section 2 title
  assert.match(html, /שם מלא/); // question label
  assert.match(html, /טקסט קצר/); // type chip
  assert.match(html, /פרסום גרסה/); // draft → publish CTA
  assert.match(html, /הוספת מקטע/);
  assert.match(html, /⚡/); // conditional indicator on q_workshop_type
  await unmount();
});

test('runtime renders EVERY Slice-1 question type', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he' }),
  );
  const html = container.innerHTML;
  for (const label of [
    'שם מלא', 'הערות', 'מספר משתתפים', 'אימייל', 'טלפון', 'אתר',
    'תאריך הגעה', 'שעת הגעה', 'מועד מדויק', 'אירוע VIP', 'סוג פעילות',
    'שפות מועדפות', 'שביעות רצון צפויה', 'דירוג', 'תקציב',
  ]) {
    assert.match(html, new RegExp(label), `missing question: ${label}`);
  }
  assert.match(html, /שימו לב/); // static_text HTML block
  assert.match(html, /ברוכים הבאים לשאלון/); // intro
  assert.match(html, /אחר…/); // allowOther pill
  assert.match(html, /\*/); // required indicator
  assert.match(html, /כפי שמופיע בתעודה/); // help text
  await unmount();
});

test('conditional question is HIDDEN until its condition is met (shared evaluator)', async () => {
  // No answers → q_workshop_type (visibleWhen q_kind == workshop) hidden.
  const hidden = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he' }),
  );
  assert.doesNotMatch(hidden.container.innerHTML, /איזו סדנה\?/);
  await hidden.unmount();

  // Prefilled answer meets the condition → question appears.
  const shown = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: RUNTIME,
      language: 'he',
      initialAnswers: { q_kind: 'workshop' },
    }),
  );
  assert.match(shown.container.innerHTML, /איזו סדנה\?/);
  await shown.unmount();
});

test('readOnly runtime renders values instead of inputs', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: RUNTIME,
      language: 'he',
      readOnly: true,
      initialAnswers: { q_name: 'דנה כהן', q_vip: true, q_kind: 'tour', q_langs: ['he', 'en'] },
    }),
  );
  const html = container.innerHTML;
  assert.match(html, /דנה כהן/);
  assert.match(html, /סיור/); // option label resolved, not raw value
  assert.match(html, /עברית, אנגלית/);
  assert.equal(container.querySelectorAll('input, select, textarea').length, 0);
  await unmount();
});

test('preview page renders the runtime with the preview badge and outro flow', async () => {
  const { container, unmount } = await render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/preview/questionnaire/ver1'] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/preview/questionnaire/:versionId',
          element: React.createElement(QuestionnairePreviewPage),
        }),
      ),
    ),
  );
  assert.match(container.innerHTML, /תצוגה מקדימה — התשובות אינן נשמרות/);
  assert.match(container.innerHTML, /שאלון בדיקה/);
  await unmount();
});
