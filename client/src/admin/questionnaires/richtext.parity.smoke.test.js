import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Rich-text rendering parity smoke — the system invariant (CLAUDE.md §16):
// every rich-text display surface renders through the ONE canonical
// RichText component (.gos-prose + richHtmlForDisplay), matching the editor:
//   • structure preserved: paragraphs, blank lines, headings, bullet +
//     numbered lists, bold/italic, links, RTL Hebrew + LTR English
//   • the THANK-YOU screens (public form, staff dialog, builder preview)
//     keep paragraph separation instead of collapsing to one line —
//     the regression this suite exists for
//   • plain textarea-authored content gets its newlines back as <p>/<br>
//   • intro, static text, preview, and read-only views all carry the
//     same .gos-prose contract — no leftover dead `prose prose-sm`

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'richtext-parity-smoke');

// Every formatting feature the parity rule guarantees, in one fixture.
const RICH_HE =
  '<h2>ברוכים הבאים</h2>' +
  '<p>פסקה ראשונה עם <strong>מודגש</strong> וגם <em>נטוי</em>.</p>' +
  '<p>פסקה שנייה — נפרדת לגמרי.</p>' +
  '<ul><li>נקודה ראשונה</li><li>נקודה שנייה</li></ul>' +
  '<ol><li>שלב ראשון</li><li>שלב שני</li></ol>' +
  '<p><a href="https://grafitiyul.co.il">קישור לאתר</a></p>';

const OUTRO_RICH_HE = '<p>תודה רבה על המילוי!</p><p>ניצור קשר <strong>בהקדם</strong>.</p>';
const OUTRO_RICH_EN = '<p>Thank you so much!</p><p>We will reply <strong>soon</strong>.</p>';
// Textarea-authored outro: blank line = paragraph break, single \n = soft break.
const OUTRO_PLAIN = 'תודה רבה!\n\nניצור קשר בקרוב.\nצוות גרפיטיול';

const RUNTIME = {
  template: {
    id: 'tpl1', key: 'rt', purpose: 'general',
    title: { he: 'שאלון', en: 'Form' }, description: null, audience: 'both',
    defaultLanguage: 'he', supportedLanguages: ['he', 'en'],
  },
  version: {
    id: 'ver1', versionNo: 1, status: 'published', displayMode: 'full_list',
    intro: { he: RICH_HE, en: '<p>First paragraph.</p><p>Second paragraph.</p>' },
    outro: { he: OUTRO_RICH_HE, en: OUTRO_RICH_EN },
  },
  sections: [
    {
      id: 'sec1', key: 's_a', title: { he: 'פרטים', en: 'Details' }, description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        {
          id: 'q1', key: 'q_static', type: 'static_text',
          label: { he: '<p>שימו לב:</p><p>הפרטים <strong>חסויים</strong>.</p>' },
          helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [],
        },
        {
          id: 'q2', key: 'q_name', type: 'text',
          label: { he: 'שם', en: 'Name' }, helpText: null, placeholder: null,
          required: false, config: null, visibleWhen: null, options: [],
        },
      ],
    },
  ],
};

// Same structure, plain-text outro (the textarea-authoring path).
const RUNTIME_PLAIN_OUTRO = {
  ...RUNTIME,
  version: { ...RUNTIME.version, outro: { he: OUTRO_PLAIN } },
};

let publicFormStatus = 'draft';
let publicFormRuntime = RUNTIME;

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let RichText;
let QuestionnaireRuntime;
let PublicFormPage;
let QuestionnairePreviewPage;
let QuestionnaireFillDialog;

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
    let body;
    if (u.startsWith('/api/public/form/')) {
      if ((opts.method || 'GET') === 'POST') body = { ok: true };
      else {
        body = {
          status: publicFormStatus, language: 'he',
          subject: null, runtime: publicFormRuntime, answers: {}, prefill: {},
          submittedAt: null, outroOnly: false,
        };
      }
    } else if (u === '/api/questionnaires/submissions/start') {
      body = { id: 'sub1' };
    } else if (u.startsWith('/api/questionnaires/submissions/sub1/submit')) {
      body = { ok: true };
    } else if (u.startsWith('/api/questionnaires/submissions/sub1')) {
      body = {
        submission: { id: 'sub1', status: 'draft', language: 'he', answers: [] },
        runtime: RUNTIME, prefill: {},
      };
    } else if (u.startsWith('/api/questionnaires/versions/ver1')) {
      body = RUNTIME;
    } else {
      body = [];
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  RichText = await bundle(esbuild, '../../editor/RichText.jsx');
  QuestionnaireRuntime = await bundle(esbuild, '../../questionnaire/QuestionnaireRuntime.jsx');
  PublicFormPage = await bundle(esbuild, '../../questionnaire/PublicFormPage.jsx');
  QuestionnairePreviewPage = await bundle(esbuild, 'QuestionnairePreviewPage.jsx');
  QuestionnaireFillDialog = await bundle(esbuild, '../../questionnaire/QuestionnaireFillDialog.jsx');

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

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

const proseIn = (container) => container.querySelector('.gos-prose');

test('RichText: every supported formatting feature survives rendering, RTL + LTR', async () => {
  const { container, unmount } = await render(React.createElement(RichText, { html: RICH_HE, dir: 'rtl' }));
  const prose = proseIn(container);
  assert.ok(prose, 'canonical .gos-prose wrapper');
  assert.equal(prose.getAttribute('dir'), 'rtl');
  assert.equal(prose.querySelectorAll('p').length, 3, 'paragraph separation preserved');
  assert.ok(prose.querySelector('h2'), 'heading');
  assert.equal(prose.querySelectorAll('ul li').length, 2, 'bullet list');
  assert.equal(prose.querySelectorAll('ol li').length, 2, 'numbered list');
  assert.ok(prose.querySelector('strong'), 'bold');
  assert.ok(prose.querySelector('em'), 'italic');
  assert.equal(prose.querySelector('a')?.getAttribute('href'), 'https://grafitiyul.co.il', 'link');
  await unmount();

  const ltr = await render(React.createElement(RichText, { html: OUTRO_RICH_EN, dir: 'ltr' }));
  assert.equal(proseIn(ltr.container)?.getAttribute('dir'), 'ltr', 'LTR English direction');
  await ltr.unmount();
});

test('RichText: plain textarea text — blank line becomes a paragraph, \\n a soft break', async () => {
  const { container, unmount } = await render(React.createElement(RichText, { html: OUTRO_PLAIN, dir: 'rtl' }));
  const prose = proseIn(container);
  const paras = prose.querySelectorAll('p');
  assert.equal(paras.length, 2, 'blank line → two paragraphs');
  assert.ok(paras[1].querySelector('br'), 'single newline → soft <br> inside the paragraph');
  assert.match(prose.textContent, /צוות גרפיטיול/);
  await unmount();
});

test('runtime: intro and static text render through the canonical renderer', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he' }),
  );
  const proses = container.querySelectorAll('.gos-prose');
  assert.ok(proses.length >= 2, 'intro + static text both canonical');
  const html = container.innerHTML;
  assert.doesNotMatch(html, /prose prose-sm/, 'dead Tailwind-typography classes are gone');
  // Intro structure intact inside the runtime.
  assert.equal(proses[0].querySelectorAll('ul li').length, 2);
  assert.equal(proses[0].querySelectorAll('p').length, 3);
  // Static text keeps its own paragraph break.
  assert.match(html, /חסויים/);
  await unmount();
});

test('runtime LTR: English intro carries dir="ltr" on the prose root', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'en' }),
  );
  const prose = proseIn(container);
  assert.equal(prose.getAttribute('dir'), 'ltr');
  assert.equal(prose.querySelectorAll('p').length, 2, 'English paragraphs preserved');
  await unmount();
});

test('REGRESSION public thank-you: outro keeps paragraph separation, never escaped text', async () => {
  publicFormStatus = 'submitted';
  publicFormRuntime = RUNTIME;
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/form/tok1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/form/:token', element: React.createElement(PublicFormPage) }))),
  );
  const prose = proseIn(container);
  assert.ok(prose, 'thank-you renders through the canonical renderer');
  assert.equal(prose.querySelectorAll('p').length, 2, 'TWO paragraphs — spacing structure preserved');
  assert.ok(prose.querySelector('strong'), 'inline marks preserved');
  assert.doesNotMatch(container.innerHTML, /&lt;p&gt;/, 'HTML is rendered, not escaped');
  await unmount();
});

test('REGRESSION public thank-you: textarea-authored outro keeps its line structure', async () => {
  publicFormStatus = 'submitted';
  publicFormRuntime = RUNTIME_PLAIN_OUTRO;
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/form/tok2'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/form/:token', element: React.createElement(PublicFormPage) }))),
  );
  const prose = proseIn(container);
  assert.ok(prose);
  assert.equal(prose.querySelectorAll('p').length, 2, 'blank line preserved as paragraph break');
  assert.ok(prose.querySelector('br'), 'single line break preserved');
  await unmount();
});

test('builder preview thank-you: same canonical renderer after submit', async () => {
  publicFormRuntime = RUNTIME;
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/preview/questionnaire/ver1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/preview/questionnaire/:versionId', element: React.createElement(QuestionnairePreviewPage) }))),
  );
  const submitBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'שליחה');
  assert.ok(submitBtn, 'preview submit button');
  await click(submitBtn);
  const done = container.querySelectorAll('.gos-prose');
  const outroProse = [...done].find((p) => /תודה רבה על המילוי/.test(p.textContent));
  assert.ok(outroProse, 'preview thank-you uses the canonical renderer');
  assert.equal(outroProse.querySelectorAll('p').length, 2);
  await unmount();
});

test('staff fill dialog thank-you: outro renders rich after submit', async () => {
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnaireFillDialog, { open: true, purpose: 'general', subjectType: null, subjectId: null })),
  );
  const submitBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'שלח');
  assert.ok(submitBtn, 'dialog submit button');
  await click(submitBtn);
  const outroProse = [...container.querySelectorAll('.gos-prose')].find((p) => /תודה רבה על המילוי/.test(p.textContent));
  assert.ok(outroProse, 'dialog thank-you uses the canonical renderer');
  assert.equal(outroProse.querySelectorAll('p').length, 2, 'paragraph spacing preserved');
  assert.ok(outroProse.querySelector('strong'));
  await unmount();
});

test('read-only view: static text stays rich through the shared runtime', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, { runtime: RUNTIME, language: 'he', readOnly: true }),
  );
  const prose = [...container.querySelectorAll('.gos-prose')].find((p) => /חסויים/.test(p.textContent));
  assert.ok(prose, 'read-only static text uses the canonical renderer');
  assert.ok(prose.querySelector('strong'));
  await unmount();
});
