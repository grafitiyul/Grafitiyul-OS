import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Regression guard for the production report "טעינת הנוסח נכשלה".
//
// Two defects of one class:
//   1. the composer asked the server for the GUIDE'S preferred language even
//      when the template demonstrably had no body in it — a Hebrew-only
//      template opened for an English-preferring guide produced a failed load
//      instead of a usable draft;
//   2. every failure collapsed into one sentence the operator could not act
//      on. Retrying does not add an English body or undo a deleted template.
//
// Proven here: the language actually opened, the fact that it switched being
// SAID rather than silent, a per-code error message, and — in every failure —
// an editor that is still open and writable.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'guide-msg-resolve-smoke');

const ACCOUNTS = [
  { id: 'main', label: 'מכירות', connected: true, bridgeConfigured: true },
  { id: 'office', label: 'שירות לקוחות', connected: true, bridgeConfigured: true },
];

// Rafael's real production shape: an assigned guide whose canonical profile
// says English.
const SUBJECT_EN = {
  tour: { id: 'te1', date: '2026-08-03', startTime: '18:30', productName: 'סיור וסדנת גרפיטי', cityName: 'תל אביב' },
  dealId: 'd1',
  reviewItemId: 'ri1',
  recipients: [{
    personRefId: 'g1', name: 'Rafael Villela', role: 'guide', isLead: false,
    submittedSummary: true, phone: '0548974326', language: 'en', state: 'ok', canSend: true,
  }],
  defaultPersonRefId: 'g1',
  defaultLanguage: 'en',
  accounts: ACCOUNTS,
  defaultAccountId: 'main',
};
const SUBJECT_HE = {
  ...SUBJECT_EN,
  recipients: [{ ...SUBJECT_EN.recipients[0], personRefId: 'g2', name: 'רוני שלו', language: 'he' }],
  defaultPersonRefId: 'g2',
  defaultLanguage: 'he',
};

const BOTH = { id: 't1', nameHe: 'תבנית 1', hasHe: true, hasEn: true, isActive: true, audience: 'guide', isAudienceDefault: true, sendAccountId: null, effectiveSendAccountId: 'office' };
const HE_ONLY = { ...BOTH, id: 't2', nameHe: 'עברית בלבד', hasHe: true, hasEn: false };
const EN_ONLY = { ...BOTH, id: 't3', nameHe: 'אנגלית בלבד', hasHe: false, hasEn: true };

let calls = [];
let subject = SUBJECT_EN;
let templates = [BOTH];
let resolveFail = null; // { status, body }

let React;
let createRoot;
let act;
let GuideMessageDialog;
let openableLanguage;
let resolveErrorText;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    MouseEvent: window.MouseEvent, CustomEvent: window.CustomEvent,
  });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  }
  if (typeof globalThis.crypto === 'undefined') globalThis.crypto = { randomUUID: () => 'uuid-test' };
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
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: (opts.method || 'GET').toUpperCase(), body });
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/api/guide-message/subject')) return json(subject);
    if (u.includes('/api/guide-message/resolve')) {
      if (resolveFail) {
        return {
          ok: false, status: resolveFail.status,
          json: async () => resolveFail.body, text: async () => JSON.stringify(resolveFail.body),
        };
      }
      return json({ templateId: body.templateId, language: body.lang, text: `[${body.lang}] נוסח`, missingVariables: [] });
    }
    if (u.includes('/api/whatsapp-templates')) return json(templates);
    return json({});
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'guideMessage.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'GuideMessageDialog.jsx')],
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    packages: 'external', plugins: [assetStubPlugin], outfile, logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  GuideMessageDialog = mod.default;
  ({ openableLanguage, resolveErrorText } = mod);

  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

beforeEach(() => {
  calls = [];
  subject = SUBJECT_EN;
  templates = [BOTH];
  resolveFail = null;
  document.body.innerHTML = '';
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const editor = () => document.querySelector('textarea');
async function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await act(async () => { await sleep(60); });
}
const text = () => document.body.textContent;
const resolves = () => calls.filter((c) => c.url.includes('/guide-message/resolve'));

async function render() {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  await act(async () => root.render(React.createElement(GuideMessageDialog, {
    open: true, tourEventId: 'te1', reviewItemId: 'ri1', onClose: () => {}, onSent: () => {},
  })));
  await act(async () => { await sleep(150); });
  return { unmount: async () => { await act(async () => root.unmount()); mountRoot.remove(); } };
}

// ── The pure rule ────────────────────────────────────────────────────────────

test('openableLanguage honours the preference when the template HAS it', () => {
  assert.deepEqual(openableLanguage(BOTH, 'en'), { lang: 'en', switched: false });
  assert.deepEqual(openableLanguage(BOTH, 'he'), { lang: 'he', switched: false });
});

test('openableLanguage falls back to the language that EXISTS, and says it switched', () => {
  assert.deepEqual(openableLanguage(HE_ONLY, 'en'), { lang: 'he', switched: true });
  assert.deepEqual(openableLanguage(EN_ONLY, 'he'), { lang: 'en', switched: true });
});

test('openableLanguage never invents a language for an empty template', () => {
  const empty = { ...BOTH, hasHe: false, hasEn: false };
  assert.deepEqual(openableLanguage(empty, 'en'), { lang: 'en', switched: false });
  assert.deepEqual(openableLanguage(null, 'he'), { lang: 'he', switched: false });
});

test('every failure code says something the operator can act on', () => {
  const cases = [
    'language_unavailable', 'not_found', 'recipient_not_on_tour',
    'recipient_required', 'tour_not_found', 'tour_required',
  ];
  for (const code of cases) {
    const msg = resolveErrorText({ payload: { error: code }, status: 409 });
    assert.ok(msg && msg.length > 12, `${code} has real wording`);
    assert.ok(!msg.startsWith('טעינת הנוסח נכשלה —'), `${code} is not the old catch-all`);
  }
  // An UNMAPPED code still names itself rather than hiding.
  assert.match(resolveErrorText({ payload: { error: 'weird_new_code' }, status: 500 }), /weird_new_code/);
  // No payload at all (a network blip) is reported as one.
  assert.match(resolveErrorText({}), /רשת/);
  assert.match(resolveErrorText({ status: 502 }), /502/);
});

// ── The behaviour, through the real component ───────────────────────────────

test('an English-preferring guide + a Hebrew-only template opens in HEBREW and says so', async () => {
  templates = [HE_ONLY];
  const ui = await render();
  assert.equal(resolves().length, 1, 'it still auto-loaded');
  assert.equal(resolves()[0].body.lang, 'he', 'it never asked for a language the template lacks');
  assert.equal(editor().value, '[he] נוסח', 'a usable draft, not an error');
  assert.match(text(), /Rafael Villela מוגדר לאנגלית/, 'the switch is stated');
  assert.match(text(), /נוסח רק בעברית/);
  assert.ok(!text().includes('טעינת הנוסח נכשלה'), 'and no failure message');
  await ui.unmount();
});

test('the Rafael case as reported: both languages present ⇒ English, no error', async () => {
  templates = [BOTH];
  const ui = await render();
  assert.equal(resolves()[0].body.lang, 'en');
  assert.equal(editor().value, '[en] נוסח');
  assert.ok(!text().includes('טעינת הנוסח נכשלה'));
  assert.ok(!text().includes('מוגדר לאנגלית'), 'nothing switched, so nothing is claimed');
  await ui.unmount();
});

test('a Hebrew-preferring guide is unaffected', async () => {
  subject = SUBJECT_HE;
  templates = [BOTH];
  const ui = await render();
  assert.equal(resolves()[0].body.lang, 'he');
  assert.equal(editor().value, '[he] נוסח');
  await ui.unmount();
});

test('a genuinely unavailable language degrades honestly — and the editor stays writable', async () => {
  templates = [{ ...BOTH, hasHe: false, hasEn: false }];
  resolveFail = { status: 409, body: { error: 'language_unavailable' } };
  const ui = await render();
  assert.match(text(), /אין נוסח בשפה הזו/, 'the real cause, not a generic failure');
  assert.ok(!text().includes('נסו שוב'), 'and not advice that cannot help');
  assert.ok(editor(), 'the composer is still open');
  assert.equal(editor().disabled, false, 'and still writable — free text always works');
  await ui.unmount();
});

test('a deleted template reports THAT, not a retry suggestion', async () => {
  resolveFail = { status: 404, body: { error: 'not_found' } };
  const ui = await render();
  assert.match(text(), /כבר לא קיימת/);
  assert.ok(editor(), 'the composer survives it');
  await ui.unmount();
});

test('an unexpected server failure names its status instead of hiding', async () => {
  resolveFail = { status: 500, body: { error: 'boom' } };
  const ui = await render();
  assert.match(text(), /boom/);
  assert.match(text(), /אפשר לכתוב הודעה חופשית/, 'and points at the way forward');
  await ui.unmount();
});

// ── THE production defect: card N asked for card N−1's guide ────────────────
//
// The dialog stays mounted and is reused for every card. Reopening it queued
// setSubject(null), but a state setter inside an effect only schedules a
// re-render — the auto-load effect later in the SAME flush still closed over
// the PREVIOUS card's subject and guide, fired the resolve for that guide, and
// marked itself done. The server answered recipient_not_on_tour and the
// operator saw a failed load.
//
// Reproduced by doing what an operator does: open one card, close it, open
// another. A single-card test cannot see this at all, which is exactly why it
// shipped.

const CARD_A = { tourEventId: 'teA', reviewItemId: 'riA', personRefId: 'guideA', name: 'מדריך א', language: 'he' };
const CARD_B = { tourEventId: 'teB', reviewItemId: 'riB', personRefId: 'guideB', name: 'Rafael Villela', language: 'en' };

function subjectFor(card) {
  return {
    tour: { id: card.tourEventId, date: '2026-08-03', startTime: '18:30', productName: 'סיור', cityName: 'תל אביב' },
    dealId: 'd1',
    reviewItemId: card.reviewItemId,
    recipients: [{
      personRefId: card.personRefId, name: card.name, role: 'guide', isLead: false,
      submittedSummary: true, phone: '0521234567', language: card.language, state: 'ok', canSend: true,
    }],
    defaultPersonRefId: card.personRefId,
    defaultLanguage: card.language,
    accounts: ACCOUNTS,
    defaultAccountId: 'main',
  };
}

async function renderCards(cards) {
  const mountRoot = document.createElement('div');
  document.body.appendChild(mountRoot);
  const root = createRoot(mountRoot);
  const el = (card, open) => React.createElement(GuideMessageDialog, {
    open,
    tourEventId: card?.tourEventId || null,
    reviewItemId: card?.reviewItemId || null,
    onClose: () => {}, onSent: () => {},
  });
  await act(async () => root.render(el(cards[0], true)));
  await act(async () => { await sleep(200); });
  return {
    // Exactly what ManagementTasksPage does: the SAME mounted dialog, closed
    // (props go null) and reopened with the next card.
    switchTo: async (card) => {
      await act(async () => root.render(el(null, false)));
      await act(async () => { await sleep(60); });
      await act(async () => root.render(el(card, true)));
      await act(async () => { await sleep(250); });
    },
    unmount: async () => { await act(async () => root.unmount()); mountRoot.remove(); },
  };
}

test('REGRESSION: the second card resolves for ITS OWN guide, not the previous card’s', async () => {
  templates = [BOTH];
  subject = subjectFor(CARD_A);
  const ui = await renderCards([CARD_A]);
  const first = resolves().at(-1).body;
  assert.equal(first.personRefId, 'guideA', 'card A used guide A');
  assert.equal(first.reviewItemId, 'riA');

  subject = subjectFor(CARD_B);
  await ui.switchTo(CARD_B);

  const second = resolves().at(-1).body;
  assert.equal(second.reviewItemId, 'riB', 'the card identity moved on');
  assert.equal(second.personRefId, 'guideB', 'AND SO DID THE GUIDE — this is the bug');
  assert.notEqual(second.personRefId, 'guideA');
  assert.equal(second.lang, 'en', "and the new guide's own language");
  assert.ok(!text().includes('טעינת הנוסח נכשלה'));
  await ui.unmount();
});

test('REGRESSION: no resolve is ever fired against a subject from another card', async () => {
  templates = [BOTH];
  subject = subjectFor(CARD_A);
  const ui = await renderCards([CARD_A]);
  subject = subjectFor(CARD_B);
  await ui.switchTo(CARD_B);
  // Every request the composer made must pair its own review item with its own
  // guide — no crossed pair at any point in the sequence.
  const pairs = resolves().map((c) => `${c.body.reviewItemId}:${c.body.personRefId}`);
  assert.deepEqual([...new Set(pairs)].sort(), ['riA:guideA', 'riB:guideB']);
  await ui.unmount();
});

test('REGRESSION: the previous card’s draft never survives into the next card', async () => {
  templates = [BOTH];
  subject = subjectFor(CARD_A);
  const ui = await renderCards([CARD_A]);
  await setValue(editor(), 'טיוטה של הכרטיס הקודם');
  subject = subjectFor(CARD_B);
  await ui.switchTo(CARD_B);
  assert.ok(!editor().value.includes('הכרטיס הקודם'), 'a stale draft cannot be sent to the wrong guide');
  assert.equal(editor().value, '[en] נוסח', 'the new card loaded its own wording');
  await ui.unmount();
});
