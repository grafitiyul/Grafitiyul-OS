import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Coordination smoke:
//   • PublicFormPage (the GENERIC public form surface — coordination itself
//     is internal-only now, but the page still serves public purposes):
//     fill state (prefill applied), thank-you state, invalid-token state
//   • CoordinationFormAction (customer card): INTERNAL operational form —
//     the button opens the staff fill dialog DIRECTLY. No link popup, no
//     copy/send actions, honest not-configured state.
//
// Cross-booking isolation is server-structural (the subject comes from the
// link row, never from the client) — asserted here by the payload contract:
// the public page never sends a subject/booking id on any write.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'coordination-smoke');

const L = (he, en) => (en ? { he, en } : { he });

const RUNTIME = {
  template: {
    id: 'tpl2', key: 'coord', purpose: 'coordination',
    title: L('שיחת תיאום', 'Coordination'), description: null, audience: 'public',
    defaultLanguage: 'he', supportedLanguages: ['he', 'en'],
  },
  version: { id: 'ver2', versionNo: 1, status: 'published', displayMode: 'full_list', intro: null, outro: L('תודה! נתראה בסיור 🎉') },
  sections: [
    {
      id: 'sec1', key: 's_cust', title: L('פרטי הלקוח'), description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        { id: 'q1', key: 'customer_name', type: 'text', label: L('שם מלא'), helpText: null, placeholder: null, required: true, config: null, visibleWhen: null, options: [] },
        { id: 'q2', key: 'customer_phone', type: 'phone', label: L('טלפון'), helpText: null, placeholder: null, required: true, config: null, visibleWhen: null, options: [] },
        { id: 'q3', key: 'arrival_notes', type: 'textarea', label: L('הערות הגעה'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
      ],
    },
  ],
};

// Mutable knobs
let publicStatus = 'draft'; // 'draft' | 'submitted' | 'invalid'
let coordinationList = [];
let startBehavior = 'ok'; // 'ok' | 'purpose_not_configured'
const writes = []; // capture public write payloads (isolation contract)

const COORD_SUBMISSION = {
  id: 'sub9', templateId: 'tpl2', versionId: 'ver2',
  subjectType: 'booking', subjectId: 'bk1', purpose: 'coordination',
  status: 'draft', language: 'he', submittedByType: 'staff',
  subjectSnapshot: { title: 'משפחת כהן' }, answers: [],
};

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let PublicFormPage;
let CoordinationFormAction;

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

  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    let body;
    let status = 200;
    if (u.startsWith('/api/public/form/tok123')) {
      if (options.method === 'PUT' || options.method === 'POST') {
        writes.push({ url: u, body: JSON.parse(options.body || '{}') });
        body = { ok: true };
      } else if (publicStatus === 'invalid') {
        status = 404;
        body = { error: 'not_found' };
      } else {
        body = {
          status: publicStatus,
          language: 'he',
          subject: { title: 'משפחת כהן', subtitle: 'סיור גרפיטי · 2026-08-06 · 17:00', date: '2026-08-06', startTime: '17:00' },
          runtime: RUNTIME,
          answers: publicStatus === 'submitted' ? { customer_name: 'דנה כהן' } : {},
          prefill: publicStatus === 'draft' ? { customer_name: 'דנה כהן', customer_phone: '0501234567' } : {},
          submittedAt: publicStatus === 'submitted' ? '2026-07-10T12:00:00Z' : null,
          outroOnly: publicStatus === 'submitted',
        };
      }
    } else if (u.startsWith('/api/questionnaires/submissions/start')) {
      if (startBehavior === 'purpose_not_configured') {
        status = 409;
        body = { error: 'purpose_not_configured' };
      } else {
        body = { ...COORD_SUBMISSION };
      }
    } else if (u.startsWith('/api/questionnaires/submissions/sub9')) {
      body = {
        submission: { ...COORD_SUBMISSION },
        runtime: RUNTIME,
        prefill: {},
        lifecycle: {
          liveVersion: true, editableAfterSubmit: true,
          structureFrozen: false, answersLocked: false, editable: true,
          closedAt: null, lockAt: null, frozenAt: null,
        },
        rendered: null,
      };
    } else if (u.startsWith('/api/questionnaires/submissions')) {
      body = coordinationList;
    } else {
      body = [];
    }
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const esbuild = await import('esbuild');
  mkdirSync(cacheDir, { recursive: true });
  PublicFormPage = await bundle(esbuild, '../../questionnaire/PublicFormPage.jsx');
  CoordinationFormAction = await bundle(esbuild, '../tours/CoordinationFormAction.jsx');

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

const renderPublic = () =>
  render(
    React.createElement(MemoryRouter, { initialEntries: ['/form/tok123'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/form/:token', element: React.createElement(PublicFormPage) }))),
  );

test('public form: draft → renders questions with booking context + prefilled identity', async () => {
  publicStatus = 'draft';
  const { container, unmount } = await renderPublic();
  const html = container.innerHTML;
  assert.match(html, /שיחת תיאום/); // template title
  assert.match(html, /משפחת כהן/); // subject context
  assert.match(html, /שם מלא/);
  assert.match(html, /הערות הגעה/);
  // Prefill from the booking adapter landed in the inputs.
  const nameInput = [...container.querySelectorAll('input')].find((i) => i.value === 'דנה כהן');
  assert.ok(nameInput, 'prefilled customer name present');
  await unmount();
});

test('public form: already-submitted link → immutable thank-you, no inputs', async () => {
  publicStatus = 'submitted';
  const { container, unmount } = await renderPublic();
  assert.match(container.innerHTML, /תודה! נתראה בסיור/); // outro
  assert.equal(container.querySelectorAll('input, textarea, select').length, 0);
  await unmount();
});

test('public form: invalid/revoked token → honest unavailable screen', async () => {
  publicStatus = 'invalid';
  const { container, unmount } = await renderPublic();
  assert.match(container.innerHTML, /הקישור אינו זמין/);
  await unmount();
});

test('public writes carry ONLY token + answers — no subject/booking ids (isolation contract)', async () => {
  // Everything the page ever wrote in prior tests went through /form/:token.
  for (const w of writes) {
    assert.match(w.url, /^\/api\/public\/form\/tok123/);
    const keys = Object.keys(w.body);
    assert.deepEqual(keys.filter((k) => k !== 'answers'), [], `unexpected write keys: ${keys}`);
  }
});

test('coordination action: internal-only — the button opens the fill dialog DIRECTLY, no link popup', async () => {
  startBehavior = 'ok';
  coordinationList = [{ id: 'sub9', status: 'draft' }];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(CoordinationFormAction, { bookingId: 'bk1' })),
  );
  assert.match(container.innerHTML, /טופס שיחת תיאום/);
  assert.match(container.innerHTML, /בתהליך/); // status chip on the button
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('טופס שיחת תיאום'));
  assert.equal(btn.disabled, false);
  await act(async () => btn.click());
  await act(async () => {});
  const html = container.innerHTML;
  // The questionnaire itself opened — no intermediate popup, no customer flow.
  assert.match(html, /שם מלא/);
  assert.match(html, /משפחת כהן/); // subject context
  assert.doesNotMatch(html, /העתקת קישור/);
  assert.doesNotMatch(html, /פתיחה בטאב חדש/);
  assert.doesNotMatch(html, /form\/tok123/);
  await unmount();
});

test('coordination action: purpose not configured → honest warning in the fill dialog', async () => {
  startBehavior = 'purpose_not_configured';
  coordinationList = [];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(CoordinationFormAction, { bookingId: 'bk1' })),
  );
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('טופס שיחת תיאום'));
  await act(async () => btn.click());
  await act(async () => {});
  assert.match(container.innerHTML, /עדיין לא נבחרה תבנית שאלון/);
  assert.match(container.innerHTML, /להגדרות סיורים/);
  await unmount();
});
