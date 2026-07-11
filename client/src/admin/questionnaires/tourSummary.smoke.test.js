import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Slice 2 smoke — Tour Summary wired through the GENERIC engine:
//   • Settings card (QuestionnairePurposeCard) renders its three honest
//     states: no template / no published version / ready
//   • QuestionnaireFillDialog: purpose-not-configured empty state, draft fill
//     (runtime renders + prefill), completed read-only view
//   • TourPage header button is ACTIVE (no more "בקרוב" placeholder) and shows
//     the submission status chip

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'tour-summary-smoke');

const L = (he) => ({ he });

const RUNTIME = {
  template: {
    id: 'tpl1', key: 'ts', purpose: 'tour_summary',
    title: L('סיכום סיור'), description: null, audience: 'staff',
    defaultLanguage: 'he', supportedLanguages: ['he'],
  },
  version: { id: 'ver1', versionNo: 1, status: 'published', displayMode: 'full_list', intro: null, outro: L('תודה על הסיכום!') },
  sections: [
    {
      id: 'sec1', key: 's_main', title: L('סיכום'), description: null,
      collapsible: false, collapsedByDefault: false, visibleWhen: null,
      questions: [
        { id: 'q1', key: 'q_how', type: 'textarea', label: L('איך היה הסיור?'), helpText: null, placeholder: null, required: true, config: null, visibleWhen: null, options: [] },
        { id: 'q2', key: 'q_guide_name', type: 'text', label: L('שם המדריך'), helpText: null, placeholder: null, required: false, config: null, visibleWhen: null, options: [] },
      ],
    },
  ],
};

const TPL_SUMMARY = {
  id: 'tpl1', key: 'ts', purpose: 'tour_summary', internalName: 'סיכום סיור',
  title: L('סיכום סיור'), status: 'active', audience: 'staff',
  defaultLanguage: 'he', supportedLanguages: ['he'], singletonPerSubject: true,
  currentVersionId: 'ver1',
  currentVersion: { id: 'ver1', versionNo: 1, publishedAt: '2026-07-10T09:00:00Z' },
  versions: [{ id: 'ver1', versionNo: 1, status: 'published', publishedAt: '2026-07-10T09:00:00Z', notes: null, updatedAt: '2026-07-10T09:00:00Z' }],
  _count: { submissions: 3 },
};

// Mutable server-state knobs (each test arranges its scenario).
let purposeConfigTemplate = null; // template object | null
let startBehavior = 'draft'; // 'draft' | 'submitted' | 'frozen' | 'not_configured'
let submissionAnswers = [];
let templatesForPurpose = [];
let tourSummaryList = [];

const SUBMISSION_BASE = {
  id: 'sub1', templateId: 'tpl1', versionId: 'ver1',
  subjectType: 'tour_event', subjectId: 'tour1', purpose: 'tour_summary',
  language: 'he', submittedByType: 'staff', submittedByRef: 'u1', submittedByName: 'dorko',
  linkId: null, subjectSnapshot: { title: 'סיור גרפיטי · 2026-08-06 · 17:00' },
  startedAt: '2026-07-10T10:00:00Z',
  template: { id: 'tpl1', key: 'ts', internalName: 'סיכום סיור', purpose: 'tour_summary', defaultLanguage: 'he', supportedLanguages: ['he'], allowResumeOnOldVersion: true, currentVersionId: 'ver1' },
};

const TOUR_DETAIL = {
  id: 'tour1', kind: 'group_slot', status: 'scheduled', date: '2026-08-06',
  startTime: '17:00', tourLanguage: 'he', capacity: 30, activeSeats: 0,
  totalBookings: 0, notes: null, product: { nameHe: 'סיור גרפיטי' },
  productVariant: null, location: { nameHe: 'תל אביב' }, bookings: [],
  // Per-guide summaries: the section renders one row per REQUIRED guide
  // (lead_guide / guide) — the workshop assistant must not get a row.
  assignments: [
    { id: 'as1', role: 'lead_guide', displayName: 'דנה לוי', externalPersonId: 'xp1', personRef: null },
    { id: 'as2', role: 'workshop_assistant', displayName: 'יוסי כהן', externalPersonId: 'xp2', personRef: null },
  ],
};

// One customer booking for the participant-card layout test.
const BOOKING = {
  id: 'bk1', status: 'active', seats: 25,
  deal: {
    id: 'd1', orderNo: 27000, title: 'אורט ישראל', status: 'won', participants: 25,
    customerInfo: null, activityType: 'business',
    organizationType: null, organizationSubtype: null,
    organization: { id: 'o1', name: 'אורט ישראל', organizationType: null },
    organizationUnit: { id: 'u1', name: 'שכבת ט' },
    contacts: [{
      roles: [], isPrimary: true,
      contact: {
        id: 'c1', firstNameHe: 'רות', lastNameHe: 'לוי', firstNameEn: null, lastNameEn: null,
        phones: [{ value: '0501111111' }], emails: [],
      },
    }],
  },
};

let tourDetail = TOUR_DETAIL; // per-test override (reset by each test)

let React;
let MemoryRouter;
let Routes;
let Route;
let createRoot;
let act;
let QuestionnairePurposeCard;
let QuestionnaireFillDialog;
let TourPage;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onResolve({ filter: /^emoji-picker-element/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
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
    if (u.startsWith('/api/questionnaires/purposes')) {
      body = {
        questionTypes: [],
        purposes: [
          { key: 'tour_summary', labelHe: 'סיכום סיור', subjectTypes: ['tour_event'], audience: 'staff', singleton: true, config: purposeConfigTemplate ? { purpose: 'tour_summary', template: purposeConfigTemplate } : null },
          { key: 'coordination', labelHe: 'שיחת תיאום', subjectTypes: ['booking'], audience: 'public', singleton: true, config: null },
          { key: 'general', labelHe: 'כללי', subjectTypes: [], audience: 'both', singleton: false, config: null },
        ],
      };
    } else if (u.startsWith('/api/questionnaires/submissions/start')) {
      if (startBehavior === 'not_configured') {
        status = 409;
        body = { error: 'purpose_not_configured' };
      } else {
        body = {
          ...SUBMISSION_BASE,
          status: startBehavior === 'frozen' ? 'submitted' : startBehavior,
          answers: submissionAnswers,
        };
      }
    } else if (u.startsWith('/api/questionnaires/submissions/sub1')) {
      // Server-computed lifecycle (tour-operational): submitted stays
      // editable; frozen = the tour closed, everything read-only.
      const frozen = startBehavior === 'frozen';
      const subStatus = frozen ? 'submitted' : startBehavior;
      body = {
        submission: {
          ...SUBMISSION_BASE,
          status: subStatus,
          submittedAt: subStatus === 'submitted' ? '2026-07-10T11:00:00Z' : null,
          frozenAt: frozen ? '2026-07-11T00:00:00Z' : null,
          answers: submissionAnswers,
        },
        runtime: RUNTIME,
        prefill: {},
        lifecycle: {
          liveVersion: true,
          editableAfterSubmit: true,
          structureFrozen: frozen,
          answersLocked: frozen,
          editable: !frozen,
          closedAt: frozen ? '2026-07-11T00:00:00Z' : null,
          lockAt: frozen ? '2026-07-13T00:00:00Z' : null,
          frozenAt: frozen ? '2026-07-11T00:00:00Z' : null,
          submitLabel: subStatus === 'draft' ? 'שלח סיכום סיור' : 'שמור עדכון',
        },
        rendered: null,
      };
    } else if (u.startsWith('/api/questionnaires/submissions')) {
      body = tourSummaryList;
    } else if (u.startsWith('/api/questionnaires?') || u === '/api/questionnaires') {
      body = templatesForPurpose;
    } else if (u.startsWith('/api/tours/tour1')) {
      body = tourDetail;
    } else if (u.startsWith('/api/tours')) {
      body = [];
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
  QuestionnairePurposeCard = await bundle(esbuild, '../settings/QuestionnairePurposeCard.jsx');
  QuestionnaireFillDialog = await bundle(esbuild, '../../questionnaire/QuestionnaireFillDialog.jsx');
  TourPage = await bundle(esbuild, '../tours/TourPage.jsx');

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

test('settings card: no template selected → honest empty state + create button', async () => {
  purposeConfigTemplate = null;
  templatesForPurpose = [];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnairePurposeCard, {
        purpose: 'tour_summary', title: 'סיכום סיור', description: 'תיאור',
      })),
  );
  assert.match(container.innerHTML, /לא נבחרה תבנית/);
  assert.match(container.innerHTML, /תבנית חדשה/);
  await unmount();
});

test('settings card: selected template WITH published version → ready chip', async () => {
  purposeConfigTemplate = TPL_SUMMARY;
  templatesForPurpose = [TPL_SUMMARY];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnairePurposeCard, {
        purpose: 'tour_summary', title: 'סיכום סיור', description: 'תיאור',
      })),
  );
  assert.match(container.innerHTML, /מוכן · v1/);
  assert.match(container.innerHTML, /עריכת התבנית/);
  await unmount();
});

test('settings card: selected template WITHOUT published version → amber warning', async () => {
  purposeConfigTemplate = { ...TPL_SUMMARY, currentVersionId: null, currentVersion: null };
  templatesForPurpose = [TPL_SUMMARY];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnairePurposeCard, {
        purpose: 'tour_summary', title: 'סיכום סיור', description: 'תיאור',
      })),
  );
  assert.match(container.innerHTML, /אין גרסה מפורסמת/);
  assert.match(container.innerHTML, /לא ניתן למלא את הטופס/);
  await unmount();
});

test('fill dialog: purpose not configured → empty state with settings link', async () => {
  startBehavior = 'not_configured';
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnaireFillDialog, {
        open: true, onClose: () => {}, purpose: 'tour_summary',
        subjectType: 'tour_event', subjectId: 'tour1', title: 'טופס סיכום סיור',
      })),
  );
  assert.match(container.innerHTML, /עדיין לא נבחרה תבנית שאלון/);
  assert.match(container.innerHTML, /להגדרות סיורים/);
  await unmount();
});

test('fill dialog: draft → runtime renders questions + subject context + autosave note', async () => {
  startBehavior = 'draft';
  submissionAnswers = [];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnaireFillDialog, {
        open: true, onClose: () => {}, purpose: 'tour_summary',
        subjectType: 'tour_event', subjectId: 'tour1', title: 'טופס סיכום סיור',
      })),
  );
  assert.match(container.innerHTML, /איך היה הסיור\?/);
  assert.match(container.innerHTML, /סיור גרפיטי · 2026-08-06/); // subjectSnapshot context
  assert.match(container.innerHTML, /נשמרות אוטומטית/);
  assert.match(container.innerHTML, /שלח סיכום סיור/); // purpose-specific primary action
  await unmount();
});

test('fill dialog: SUBMITTED stays editable (tour-operational lifecycle) — banner + inputs + שלח', async () => {
  startBehavior = 'submitted';
  submissionAnswers = [
    { id: 'a1', questionKey: 'q_how', value: 'היה מצוין, קבוצה נהדרת', questionSnapshot: { label: 'איך היה הסיור?', type: 'textarea' }, sortOrder: 0 },
  ];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnaireFillDialog, {
        open: true, onClose: () => {}, purpose: 'tour_summary',
        subjectType: 'tour_event', subjectId: 'tour1', title: 'טופס סיכום סיור',
      })),
  );
  assert.match(container.innerHTML, /הטופס הוגש/); // submitted banner
  assert.match(container.innerHTML, /להמשיך לעדכן/);
  assert.ok(container.querySelectorAll('textarea').length > 0, 'still editable');
  const ta = [...container.querySelectorAll('textarea')].find((t) => t.value === 'היה מצוין, קבוצה נהדרת');
  assert.ok(ta, 'existing answer loaded into the editable input');
  assert.match(container.innerHTML, /שמור עדכון/); // update action after first submit
  assert.doesNotMatch(container.innerHTML, /מילוי מחדש/); // no void/redo in this lifecycle
  await unmount();
});

test('fill dialog: FROZEN (tour closed) → immutable historical view, no redo', async () => {
  startBehavior = 'frozen';
  submissionAnswers = [
    { id: 'a1', questionKey: 'q_how', value: 'היה מצוין, קבוצה נהדרת', questionSnapshot: { label: 'איך היה הסיור?', type: 'textarea' }, sortOrder: 0 },
  ];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, null,
      React.createElement(QuestionnaireFillDialog, {
        open: true, onClose: () => {}, purpose: 'tour_summary',
        subjectType: 'tour_event', subjectId: 'tour1', title: 'טופס סיכום סיור',
      })),
  );
  assert.match(container.innerHTML, /תיעוד היסטורי/);
  assert.match(container.innerHTML, /היה מצוין, קבוצה נהדרת/);
  assert.equal(container.querySelectorAll('textarea').length, 0); // read-only
  assert.doesNotMatch(container.innerHTML, /מילוי מחדש/); // history cannot be voided
  await unmount();
});

test('tour page: participant card — customer → organization → "👥 25 משתתפים", "דיל #27000" in the corner', async () => {
  startBehavior = 'draft';
  tourSummaryList = [];
  tourDetail = { ...TOUR_DETAIL, bookings: [BOOKING] };
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/admin/tours/tour1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/admin/tours/:id', element: React.createElement(TourPage) }))),
  );
  const html = container.innerHTML;
  // Identity hierarchy IN ORDER: customer title → org line → participants
  // line (icon + full Hebrew count) directly below the organization.
  const identity = container.querySelector('a[title="פתיחת הדיל בכרטיסייה חדשה"]');
  assert.ok(identity, 'identity area links to the Deal (existing admin navigation)');
  const rows = [...identity.children].map((el) => el.textContent.trim());
  assert.equal(rows.length, 3, 'identity area has exactly customer/org/participants rows');
  assert.match(rows[0], /רות לוי/);
  assert.match(rows[1], /אורט ישראל · שכבת ט/);
  assert.match(rows[2], /^👥 25 משתתפים$/);
  // Corner: "דיל #27000" (never the bare number / icon+number).
  const dealRef = [...container.querySelectorAll('span')].find((s) => s.textContent.trim() === 'דיל #27000');
  assert.ok(dealRef, 'corner shows "דיל #27000"');
  // The order number no longer trails the organization line.
  assert.ok(!rows[1].includes('27000'), 'org line carries no deal number');
  // Coordination action stays in the card header.
  assert.match(html, /טופס שיחת תיאום/);
  await unmount();
});

test('tour page: per-guide summary rows — required guide gets a row with status chip, assistant does not', async () => {
  startBehavior = 'draft';
  tourDetail = TOUR_DETAIL;
  tourSummaryList = [{ ...SUBMISSION_BASE, status: 'submitted', actorScope: 'xp1', template: { id: 'tpl1', internalName: 'סיכום סיור', purpose: 'tour_summary' }, version: { versionNo: 1 } }];
  const { container, unmount } = await render(
    React.createElement(MemoryRouter, { initialEntries: ['/admin/tours/tour1'] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/admin/tours/:id', element: React.createElement(TourPage) }))),
  );
  const html = container.innerHTML;
  // The summary section renders ONE row per REQUIRED guide (per-guide model).
  assert.match(html, /סיכום סיור/);
  assert.match(html, /דנה לוי/); // required guide row
  assert.match(html, /הוגש/); // her status chip from listSubmissions (actorScope xp1)
  const openButtons = [...container.querySelectorAll('button')].filter((b) =>
    b.textContent.includes('פתיחת הטופס') || b.textContent.includes('מילוי הטופס'),
  );
  assert.equal(openButtons.length, 1, 'exactly one summary row — the workshop assistant gets none');
  assert.equal(openButtons[0].disabled, false, 'summary button is enabled');
  await unmount();
});
