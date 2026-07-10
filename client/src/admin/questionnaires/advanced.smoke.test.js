import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Slice 5 smoke — advanced capabilities:
//   • upload + signature question types render (with uploader) and are
//     honestly disabled in preview (no uploader)
//   • progress bar reflects answered/total
//   • step_by_step mode renders ONE question with back/next + progress
//   • completed-submission values render (image / file link / signature img)
//   • admin submissions view: filters + rows + status chips

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'advanced-smoke');

const L = (he) => ({ he });

const runtimeOf = (displayMode) => ({
  template: {
    id: 'tpl1', key: 'adv', purpose: 'general',
    title: L('טופס מתקדם'), description: null, audience: 'both',
    defaultLanguage: 'he', supportedLanguages: ['he'],
  },
  version: { id: `ver_${displayMode}`, versionNo: 1, status: 'draft', displayMode, intro: null, outro: null },
  sections: [
    {
      id: 'sec1', key: 's_a', title: L('מדיה'), description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        { id: 'q1', key: 'q_name', type: 'text', label: L('שם'), helpText: null, placeholder: null, required: true, config: null, visibleWhen: null, options: [] },
        { id: 'q2', key: 'q_photo', type: 'image_upload', label: L('תמונה מהשטח'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q3', key: 'q_doc', type: 'file_upload', label: L('קובץ מצורף'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
        { id: 'q4', key: 'q_sig', type: 'signature', label: L('חתימת הלקוח'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
      ],
    },
  ],
});

let submissionsList = [];

let React;
let MemoryRouter;
let createRoot;
let act;
let QuestionnaireRuntime;
let QuestionnaireSubmissionsView;

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
    if (u.startsWith('/api/questionnaires/purposes')) {
      body = { questionTypes: [], purposes: [{ key: 'general', labelHe: 'כללי', subjectTypes: [], audience: 'both', singleton: false, config: null }] };
    } else if (u.startsWith('/api/questionnaires/submissions')) {
      body = submissionsList;
    } else if (u.startsWith('/api/questionnaires')) {
      body = [];
    } else {
      body = [];
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  QuestionnaireRuntime = await bundle(esbuild, '../../questionnaire/QuestionnaireRuntime.jsx');
  QuestionnaireSubmissionsView = await bundle(esbuild, 'QuestionnaireSubmissionsView.jsx');

  React = (await import('react')).default ?? (await import('react'));
  ({ act } = await import('react'));
  ({ MemoryRouter } = await import('react-router-dom'));
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

test('upload + signature inputs render with an uploader; progress bar counts answers', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: runtimeOf('full_list'),
      language: 'he',
      initialAnswers: { q_name: 'רות' },
      onSubmit: async () => {},
      uploader: async () => ({ assetId: 'a1', url: '/api/media/a1', name: 'x.jpg', mime: 'image/jpeg', size: 1 }),
    }),
  );
  const html = container.innerHTML;
  assert.match(html, /העלאת תמונה/);
  assert.match(html, /העלאת קובץ/);
  assert.match(html, /חתמו כאן/); // signature canvas hint
  assert.ok(container.querySelector('canvas'), 'signature canvas exists');
  assert.match(html, /1 \/ 4/); // progress: name answered of 4 answerable
  await unmount();
});

test('preview (no uploader) disables uploads honestly', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: runtimeOf('full_list'),
      language: 'he',
      previewBadge: true,
      onSubmit: async () => {},
    }),
  );
  assert.match(container.innerHTML, /העלאת קבצים אינה זמינה בתצוגה מקדימה/);
  await unmount();
});

test('step_by_step: one question at a time with next/back + progress', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: runtimeOf('step_by_step'),
      language: 'he',
      onSubmit: async () => {},
    }),
  );
  const html = container.innerHTML;
  assert.match(html, /שם/); // first question shown
  assert.doesNotMatch(html, /תמונה מהשטח/); // second question NOT shown yet
  assert.match(html, /הבא/);
  assert.match(html, /הקודם/);
  assert.match(html, /0 \/ 4/);
  // required gate: clicking next without answering stays on step 1 with error
  const next = [...container.querySelectorAll('button')].find((b) => b.textContent === 'הבא');
  await act(async () => next.click());
  assert.match(container.innerHTML, /שדה חובה/);
  assert.doesNotMatch(container.innerHTML, /תמונה מהשטח/);
  await unmount();
});

test('completed values render: image thumb, file link, signature image', async () => {
  const { container, unmount } = await render(
    React.createElement(QuestionnaireRuntime, {
      runtime: runtimeOf('full_list'),
      language: 'he',
      readOnly: true,
      initialAnswers: {
        q_name: 'רות',
        q_photo: { assetId: 'a1', url: '/api/media/a1', name: 'pic.jpg', mime: 'image/jpeg', size: 5 },
        q_doc: { assetId: 'a2', url: '/api/media/a2', name: 'terms.pdf', mime: 'application/pdf', size: 9 },
        q_sig: 'data:image/png;base64,iVBORw0KGgo=',
      },
    }),
  );
  assert.ok(container.querySelector('img[src="/api/media/a1"]'), 'image thumbnail');
  assert.ok(container.querySelector('a[href="/api/media/a2"]'), 'file link');
  assert.ok(container.querySelector('img[src^="data:image/png"]'), 'signature image');
  assert.equal(container.querySelectorAll('input, canvas').length, 0, 'no inputs in readOnly');
  await unmount();
});

test('admin submissions view: filters render; rows show subject, status and attribution', async () => {
  submissionsList = [
    {
      id: 'sub1', status: 'submitted', purpose: 'general', subjectType: 'tour_event',
      subjectSnapshot: { title: 'סיור גרפיטי · 2026-08-06' },
      template: { id: 'tpl1', internalName: 'טופס מתקדם', purpose: 'general' },
      version: { versionNo: 2 },
      submittedByName: 'dorko', submittedByType: 'staff',
      submittedAt: '2026-07-10T12:00:00Z', createdAt: '2026-07-10T10:00:00Z',
    },
    {
      id: 'sub2', status: 'draft', purpose: 'general', subjectType: null,
      subjectSnapshot: null,
      template: { id: 'tpl1', internalName: 'טופס מתקדם', purpose: 'general' },
      version: { versionNo: 2 },
      submittedByName: null, submittedByType: 'public',
      submittedAt: null, createdAt: '2026-07-10T09:00:00Z',
    },
  ];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null, React.createElement(QuestionnaireSubmissionsView)),
  );
  const html = container.innerHTML;
  assert.match(html, /כל הייעודים/); // filters
  assert.match(html, /כל הסטטוסים/);
  assert.match(html, /סיור גרפיטי · 2026-08-06/); // subject snapshot title
  assert.match(html, /הוגש/); // status chip
  assert.match(html, /בתהליך/);
  assert.match(html, /dorko/); // attribution
  assert.match(html, /v2/);
  await unmount();
});
