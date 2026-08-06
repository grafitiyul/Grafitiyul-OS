import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Quote generation × the organization invariant — RENDERS the real
// GenerateQuoteModal (esbuild bundle, jsdom) against a recording fetch stub and
// proves that:
//   1. a deal with NO organization opens the completion dialog and produces
//      nothing;
//   2. picking an existing organization (offered from the contact's proven
//      membership) links it and RESUMES the generation automatically — one
//      quote, no second click;
//   3. creating a new organization does the same through the canonical create
//      API;
//   4. cancelling leaves the deal and the quote untouched;
//   5. a deal that already has an organization skips the dialog entirely;
//   6. the operator's unsaved choices in the modal survive the completion step;
//   7. double-clicking never mints two versions.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'quote-org-completion-smoke');

const CONTACT_1 = {
  id: 'c1',
  contactNo: 101,
  fullNameHe: 'ישראל ישראלי',
  firstNameHe: 'ישראל',
  lastNameHe: 'ישראלי',
  phones: [{ id: 'p1', value: '052-1111111', isPrimary: true }],
  emails: [{ id: 'e1', value: 'israel@example.com', isPrimary: true }],
  orgLinks: [
    { id: 'l1', isPrimary: true, organization: { id: 'o1', orgNo: 5, name: 'בית ספר אורט' }, organizationUnit: null },
  ],
};

const dealContact = {
  id: 'dc1',
  contactId: 'c1',
  isPrimary: true,
  receiveQuotes: true,
  contact: {
    id: 'c1',
    contactNo: 101,
    firstNameHe: 'ישראל',
    lastNameHe: 'ישראלי',
    communicationLanguage: 'he',
    phones: CONTACT_1.phones,
    emails: CONTACT_1.emails,
  },
};

const DEAL_NO_ORG = {
  id: 'deal1',
  orderNo: 27500,
  organizationId: null,
  activityType: 'business',
  communicationLanguage: 'he',
  valueMinor: 540000,
  product: { id: 'prod1', nameHe: 'סיור גרפיטי' },
  contacts: [dealContact],
};
const DEAL_WITH_ORG = { ...DEAL_NO_ORG, organizationId: 'o1' };

const DRAFT = {
  id: 'qd_draft',
  dealId: 'deal1',
  status: 'draft',
  language: 'he',
  publicToken: 'draft-token',
  displayProductName: null,
  compositionDraft: null,
  overrideState: null,
};

let calls = [];

let React;
let MemoryRouter;
let createRoot;
let act;
let GenerateQuoteModal;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (args) => ({ path: args.path, namespace: 'asset-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
};

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
  if (typeof window.matchMedia === 'undefined') {
    const mm = (q) => ({
      matches: false, media: q,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
    window.matchMedia = mm;
    globalThis.matchMedia = mm;
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.alert = () => {};

  // The stub is the SERVER's behaviour, invariant included: produce refuses
  // with organization_required until the deal is actually linked.
  let dealOrgId = null;
  globalThis.__setDealOrg = (v) => { dealOrgId = v; };
  let producedSeq = 0;
  globalThis.__producedCount = () => producedSeq;
  globalThis.__resetProduced = () => { producedSeq = 0; };

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method, body });

    let out = {};
    let status = 200;
    if (method === 'GET') {
      if (/\/api\/deals\/deal1\/quote-document$/.test(u)) out = { quoteDocument: DRAFT, created: false };
      else if (/\/api\/deals\/deal1\/quote-documents$/.test(u)) out = { activeOfferId: null, offers: [] };
      else if (/\/api\/quote-documents\/qd_draft\/compose-preview$/.test(u)) out = { blocks: [], warnings: [] };
      else if (u.includes('/api/activity-types')) out = [{ id: 'at1', key: 'business', label: 'עסקי' }];
      else if (u.includes('/api/organization-types')) out = [{ id: 't1', label: 'בית ספר', sortOrder: 1 }];
      else if (u.includes('/api/organization-subtypes')) out = [];
      else if (/\/api\/contacts\/c1$/.test(u)) out = CONTACT_1;
      else if (/\/api\/organizations\/o1$/.test(u)) {
        out = { id: 'o1', name: 'בית ספר אורט', organizationTypeId: 't1', organizationType: { id: 't1', label: 'בית ספר' }, units: [], contactLinks: [] };
      } else if (/\/api\/organizations\/o_new$/.test(u)) {
        out = { id: 'o_new', name: 'תיכון חדש', organizationTypeId: 't1', organizationType: { id: 't1', label: 'בית ספר' }, units: [], contactLinks: [] };
      } else if (u.includes('/api/organizations')) out = [];
    } else if (method === 'POST') {
      if (/\/api\/quote-documents\/qd_draft\/produce$/.test(u)) {
        if (!dealOrgId) {
          status = 422;
          out = { error: 'organization_required', message: 'כדי להפיק הצעת מחיר יש לשייך את הדיל לארגון.' };
        } else {
          producedSeq += 1;
          out = {
            quoteDocument: {
              id: `qd_v${producedSeq}`, dealId: 'deal1', status: 'produced', versionNo: producedSeq,
              language: DRAFT.language, publicToken: `tok${producedSeq}`, displayProductName: null,
            },
          };
        }
      } else if (u.endsWith('/api/organizations')) {
        out = { id: 'o_new', name: body?.name || 'תיכון חדש', organizationTypeId: body?.organizationTypeId || 't1' };
      } else out = { ok: true };
    } else if (method === 'PUT') {
      if (/\/api\/deals\/deal1$/.test(u)) {
        if (Object.prototype.hasOwnProperty.call(body || {}, 'organizationId')) dealOrgId = body.organizationId;
        out = { id: 'deal1', organizationId: dealOrgId };
      } else if (/\/api\/quote-documents\/qd_draft$/.test(u)) {
        // Draft metadata edits (language / overrides) persist on the draft.
        Object.assign(DRAFT, body || {});
        out = { quoteDocument: { ...DRAFT } };
      } else out = { ok: true };
    }
    return {
      ok: status < 400,
      status,
      json: async () => out,
      text: async () => JSON.stringify(out),
    };
  };

  const esbuild = (await import(pathToFileURL(path.join(clientRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href)).default;
  const outfile = path.join(cacheDir, 'generateQuoteModal.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'GenerateQuoteModal.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    packages: 'external',
    plugins: [assetStubPlugin],
    outfile,
    logLevel: 'silent',
  });
  GenerateQuoteModal = (await import(pathToFileURL(outfile).href)).default;

  React = (await import('react')).default;
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});

let activeRoot = null;

beforeEach(() => {
  calls = [];
  globalThis.__resetProduced();
  DRAFT.language = 'he'; // the draft is server state — reset it per test
});

// Dialogs portal into document.body, so each test starts from a clean body —
// otherwise one failure would leak its DOM into the next assertion.
afterEach(async () => {
  if (activeRoot) {
    await act(async () => activeRoot.unmount());
    activeRoot = null;
  }
  document.body.innerHTML = '';
});

// `serverOrgId` lets a test simulate the deal being unlinked elsewhere (the
// client thinks there is an organization; the server refuses).
async function render(deal, { serverOrgId = undefined } = {}) {
  document.body.innerHTML = '';
  globalThis.__setDealOrg(serverOrgId === undefined ? deal.organizationId || null : serverOrgId);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoot = root;
  await act(async () =>
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/admin/crm/deals/27500'] },
        React.createElement(GenerateQuoteModal, {
          open: true,
          deal,
          onClose: () => {},
          onGenerated: () => {},
          onDealChanged: () => {},
        }),
      ),
    ),
  );
  await act(async () => {});
  return {
    unmount: async () => {
      await act(async () => root.unmount());
      activeRoot = null;
      container.remove();
    },
  };
}

// Everything (dialogs included) is portaled into document.body.
const ORG_DIALOG = 'נדרש ארגון להפקת הצעת מחיר';
const html = () => document.body.innerHTML;
const findButtonIn = (root, text) =>
  [...(root || document.body).querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));
const findButton = (text) => findButtonIn(document.body, text);
// The completion dialog's own subtree — several labels (ביטול) exist in both
// the generation modal and the dialog above it.
const orgDialog = () => document.body.querySelector(`[role="dialog"][aria-label="${ORG_DIALOG}"]`);
const inOrgDialog = (text) => findButtonIn(orgDialog(), text);
const click = async (el) => {
  assert.ok(el, 'element to click exists');
  await act(async () => el.click());
  await act(async () => {});
};
const produceCalls = () => calls.filter((c) => c.method === 'POST' && /\/produce$/.test(c.url));
const dealWrites = () => calls.filter((c) => c.method === 'PUT' && /\/api\/deals\/deal1$/.test(c.url));

test('no organization → the completion dialog opens and NOTHING is produced', async () => {
  const { unmount } = await render(DEAL_NO_ORG);

  await click(findButton('הפק הצעת מחיר'));

  assert.match(html(), /נדרש ארגון להפקת הצעת מחיר/, 'the completion dialog opened');
  assert.match(html(), /כדי להפיק הצעת מחיר יש לשייך את הדיל לארגון/, 'it says why');
  assert.ok(inOrgDialog('שמור ארגון והמשך להפקת ההצעה'), 'the primary action continues the original flow');
  assert.equal(produceCalls().length, 0, 'no quote was generated');
  assert.equal(dealWrites().length, 0, 'the deal was not touched');
  // The contact's PROVEN organization is offered first.
  assert.match(html(), /בית ספר אורט/, "the contact's organization is suggested");
  await unmount();
});

test('picking the suggested organization links it and RESUMES generation automatically', async () => {
  const { unmount } = await render(DEAL_NO_ORG);
  await click(findButton('הפק הצעת מחיר'));

  // One click on the suggestion, one on the primary action — no "הפק" again.
  await click(inOrgDialog('בית ספר אורט'));
  await click(inOrgDialog('שמור ארגון והמשך להפקת ההצעה'));

  const writes = dealWrites();
  assert.equal(writes.length, 1, 'the organization link is committed exactly once');
  assert.equal(writes[0].body.organizationId, 'o1');
  assert.equal(produceCalls().length, 1, 'exactly ONE quote was produced, automatically');
  // The link is committed BEFORE the quote is created.
  const orderOk = calls.findIndex((c) => c.method === 'PUT' && /\/api\/deals\/deal1$/.test(c.url)) <
    calls.findIndex((c) => c.method === 'POST' && /\/produce$/.test(c.url));
  assert.ok(orderOk, 'no quote is created before the organization link is committed');
  assert.match(html(), /הצעת המחיר הופקה/, 'the flow continued through to the generated quote');
  assert.doesNotMatch(html(), /נדרש ארגון להפקת הצעת מחיר/, 'the completion dialog is gone');
  await unmount();
});

test('creating a new organization links it and resumes just the same', async () => {
  const { unmount } = await render(DEAL_NO_ORG);
  await click(findButton('הפק הצעת מחיר'));

  // Type a fresh name in the canonical picker → a NEW organization (type required).
  const orgInput = [...document.body.querySelectorAll('input')].find((i) => i.placeholder === 'הקלידו שם ארגון…');
  assert.ok(orgInput, 'the canonical organization picker is the input surface');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(orgInput, 'תיכון חדש');
    orgInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => {});
  const typeSelect = [...document.body.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 't1'),
  );
  assert.ok(typeSelect, 'a new organization must get a type');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(typeSelect, 't1');
    typeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await act(async () => {});

  await click(inOrgDialog('שמור ארגון והמשך להפקת ההצעה'));

  const creates = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/organizations'));
  assert.equal(creates.length, 1, 'ONE organization created, through the canonical create API');
  assert.equal(creates[0].body.name, 'תיכון חדש');
  assert.equal(dealWrites()[0].body.organizationId, 'o_new', 'the new organization is linked to the deal');
  assert.equal(produceCalls().length, 1, 'generation resumed automatically — exactly one quote');
  await unmount();
});

test('cancelling the completion dialog produces no quote and changes no organization', async () => {
  const { unmount } = await render(DEAL_NO_ORG);
  await click(findButton('הפק הצעת מחיר'));
  assert.match(html(), /נדרש ארגון להפקת הצעת מחיר/);

  await click(inOrgDialog('ביטול'));

  assert.doesNotMatch(html(), /נדרש ארגון להפקת הצעת מחיר/, 'the dialog closed');
  assert.equal(produceCalls().length, 0, 'no quote');
  assert.equal(dealWrites().length, 0, 'no organization change');
  assert.equal(
    calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/organizations')).length,
    0,
    'no organization created',
  );
  // The generation workspace is still there, untouched, ready to try again.
  assert.ok(findButton('הפק הצעת מחיר'), 'the operator is back in the preview with the action intact');
  await unmount();
});

test('a deal that already has an organization generates immediately — no dialog', async () => {
  const { unmount } = await render(DEAL_WITH_ORG);

  await click(findButton('הפק הצעת מחיר'));

  assert.doesNotMatch(html(), /נדרש ארגון להפקת הצעת מחיר/, 'no completion step');
  assert.equal(produceCalls().length, 1);
  assert.equal(dealWrites().length, 0, 'an existing link is never rewritten');
  assert.match(html(), /הצעת המחיר הופקה/);
  await unmount();
});

test("the operator's unsaved choices survive the completion step", async () => {
  const { unmount } = await render(DEAL_NO_ORG);

  // Choose a non-default action and language BEFORE generating — the modal must
  // stay mounted through the completion dialog and resume with them intact.
  await click(findButton('שליחה במייל'));
  await click(findButton('EN'));
  assert.ok(findButton('הפק ושלח במייל'), 'the chosen action is reflected on the primary button');

  await click(findButton('הפק ושלח במייל'));
  assert.match(html(), /נדרש ארגון להפקת הצעת מחיר/);

  await click(inOrgDialog('בית ספר אורט'));
  await click(inOrgDialog('שמור ארגון והמשך להפקת ההצעה'));

  assert.equal(produceCalls().length, 1);
  // Resumed as the EMAIL action (not a bare generation): the review step opened
  // with the deal contact's address prefilled.
  assert.match(html(), /עברו על המייל לפני השליחה/, 'the original send-by-email action was resumed');
  const to = [...document.body.querySelectorAll('input')].find((i) => i.value === 'israel@example.com');
  assert.ok(to, 'the recipient carried through');
  // The language choice made before the completion step was kept.
  const langUpdate = calls.filter((c) => c.method === 'PUT' && /\/api\/quote-documents\/qd_draft$/.test(c.url));
  assert.ok(langUpdate.some((c) => c.body?.language === 'en'), 'the language switch was preserved, not replayed');
  await unmount();
});

test("the server's organization_required becomes the dialog, never a raw error", async () => {
  // The client believes the deal is linked; the organization was removed in
  // another tab. The 422 must land in the completion flow, not in an alert.
  const { unmount } = await render(DEAL_WITH_ORG, { serverOrgId: null });

  await click(findButton('הפק הצעת מחיר'));

  assert.equal(produceCalls().length, 1, 'the server was asked, and refused');
  assert.match(html(), /נדרש ארגון להפקת הצעת מחיר/, 'the refusal opened the completion dialog');
  assert.doesNotMatch(html(), /organization_required/, 'the operator never sees the raw code');

  // Completing it resumes and produces exactly one quote.
  // The deal already names an organization, so the picker opens with it
  // selected — one confirming click is all the completion needs.
  await click(inOrgDialog('שמור ארגון והמשך להפקת ההצעה'));
  assert.equal(produceCalls().length, 2, 'one refused call + one successful call');
  assert.equal(globalThis.__producedCount(), 1, 'exactly ONE quote document was created');
  await unmount();
});

test('double-clicking generate never mints two versions', async () => {
  const { unmount } = await render(DEAL_WITH_ORG);
  const btn = findButton('הפק הצעת מחיר');
  await act(async () => {
    btn.click();
    btn.click();
  });
  await act(async () => {});
  assert.equal(produceCalls().length, 1, 'exactly one produce call');
  await unmount();
});

test('a retry after the completion step does not duplicate the quote', async () => {
  const { unmount } = await render(DEAL_NO_ORG);
  await click(findButton('הפק הצעת מחיר'));
  await click(findButton('בית ספר אורט'));
  const save = inOrgDialog('שמור ארגון והמשך להפקת ההצעה');
  // Impatient double-click on the completion action.
  await act(async () => {
    save.click();
    save.click();
  });
  await act(async () => {});
  assert.equal(dealWrites().length, 1, 'one link commit');
  assert.equal(produceCalls().length, 1, 'one quote');
  await unmount();
});
