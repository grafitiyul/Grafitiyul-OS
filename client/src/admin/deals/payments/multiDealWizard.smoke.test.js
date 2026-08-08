import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// "מסמך אחד לדילים שונים" — RENDER smoke.
//
// This wizard is the entry point to a REAL accounting document, so a build that
// merely compiles is not enough: a bad hook order, a missing prop or a null
// dereference would only appear the moment the operator opened it. This drives
// the real component through the real steps against stubbed endpoints, and
// asserts the things the operator must be able to see at every stage:
//
//   which deal · which source document · how much of it · what remains
//
// It renders only. Nothing is issued, and the wizard has no issue path at all.

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..', '..', '..', '..');
const cacheDir = path.join(clientRoot, 'node_modules', '.cache', 'multideal-wizard-smoke');

const DOC_TYPES = [
  { key: 'deal', label: 'חשבון עסקה', paymentsAllowed: false, paymentsRequired: false, baseTypes: [], baseRequired: false },
  { key: 'invrec', label: 'חשבונית מס קבלה', paymentsAllowed: true, paymentsRequired: true, baseTypes: ['deal'], baseRequired: false },
  { key: 'receipt', label: 'קבלה', paymentsAllowed: true, paymentsRequired: true, baseTypes: ['invoice'], baseRequired: false },
];

let React;
let createRoot;
let act;
let Wizard;

const assetStubPlugin = {
  name: 'asset-stub',
  setup(build) {
    build.onResolve({ filter: /(\.css$|\?url$|\?raw$)/ }, (a) => ({ path: a.path, namespace: 'asset-stub' }));
    build.onResolve({ filter: /^emoji-picker-element/ }, (a) => ({ path: a.path, namespace: 'asset-stub' }));
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
  window.scrollTo = () => {};
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

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    let body = {};
    if (u.includes('/api/deals/deal-1') && !u.includes('multi-deal')) {
      body = {
        id: 'deal-1', orderNo: 27101, title: 'ליד חדש — דנה', valueMinor: 100000, currency: 'ILS',
        organization: null, product: { nameHe: 'סיור גרפיטי' }, tourDate: '2026-09-01',
        contacts: [{ isPrimary: true, contact: { firstNameHe: 'דנה', lastNameHe: 'כהן', firstNameEn: '', lastNameEn: '' } }],
      };
    } else if (u.includes('multi-deal-document/sources')) {
      body = {
        candidates: [
          { doctype: 'deal', doctypeLabel: 'חשבון עסקה', docnum: '1234', amountIls: 1000, issuedAt: '2026-08-01', clientName: 'דנה כהן', status: 'open', origin: 'gos' },
          { doctype: 'deal', doctypeLabel: 'חשבון עסקה', docnum: '1111', amountIls: 400, issuedAt: '2026-01-01', clientName: 'דנה כהן', status: null, origin: 'gos' },
        ],
        liveError: null,
      };
    } else if (u.includes('multi-deal-document/prepare')) {
      const sent = JSON.parse(init.body);
      body = {
        doctype: sent.doctype, doctypeLabel: 'חשבונית מס קבלה',
        perDeal: [{
          dealId: 'deal-1', orderNo: 27101, contactName: 'דנה כהן', dealTitle: 'ליד חדש — דנה',
          basedOn: { doctype: 'deal', docnum: '1234' }, basedOnLabel: 'חשבון עסקה',
          sourceAmountIls: 1000, allocationIls: 700, fullSettlement: false, remainingAfterIls: 300,
          rows: [{ description: 'חשבון עסקה 1234 — תשלום על החשבון', quantity: 1, unitPriceIls: 700, vatExempt: false }],
          sourceError: null,
        }],
        rows: [{ description: 'חשבון עסקה 1234 — תשלום על החשבון', quantity: 1, unitPriceIls: 700, vatExempt: false }],
        notes: 'דיל #27101 — דנה כהן\nחשבון עסקה 1234 שולם 700 ₪ מתוך 1,000 ₪',
        basedOnDocs: [{ doctype: 'deal', docnum: '1234' }],
        vatMode: 'included', currency: 'ILS', language: 'he',
        amountIls: 700, allocatedIls: 700, linesTotalIls: 700,
        reconciliation: { realMinor: 70000, allocatedMinor: 70000, unallocatedMinor: 0, overAllocatedMinor: 0, balanced: true, state: 'balanced', dealCount: 1 },
        allocations: [{ dealId: 'deal-1', orderNo: 27101, amountMinor: 70000 }],
        crossCustomer: { cross: false, deals: [] },
      };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  mkdirSync(cacheDir, { recursive: true });
  const esbuild = await import('esbuild');
  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));

  const outfile = path.join(cacheDir, 'wizard.bundle.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, 'MultiDealDocumentWizard.jsx')],
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    packages: 'external', plugins: [assetStubPlugin], outfile, logLevel: 'silent',
  });
  Wizard = (await import(pathToFileURL(outfile).href)).default;
});

async function mount(props = {}) {
  // The dialog portals into document.body, so each mount starts from a clean
  // one — otherwise a previous test's DOM is still matchable.
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Wizard, {
      open: true, dealId: 'deal-1', docTypes: DOC_TYPES,
      onClose: () => {}, onConfirm: () => {}, ...props,
    }));
  });

  const click = async (text) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));
    assert.ok(el, `no button matching "${text}". Buttons: ${[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).join(' | ')}`);
    await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  };

  // Source documents are radio choices inside a label, not buttons.
  const pick = async (text) => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(text));
    assert.ok(label, `no choice matching "${text}"`);
    const input = label.querySelector('input');
    assert.ok(input, `choice "${text}" has no input`);
    await act(async () => {
      input.checked = true;
      input.dispatchEvent(new window.Event('click', { bubbles: true }));
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
  };

  return { host, root, click, pick, text: () => document.body.textContent };
}

// ── It opens, and asks the right first question ──────────────────────────────

test('the wizard opens on the document type — the choice everything follows from', async () => {
  const { text } = await mount();
  assert.match(text(), /איזה מסמך להפיק\?/);
  // The canonical registry, not a second list.
  assert.match(text(), /חשבונית מס קבלה/);
  assert.match(text(), /חשבון עסקה/);
  // And it says up front that nothing is issued here.
  assert.match(text(), /שום מסמך לא מופק כאן/);
});

// ── Deal #1 + its source document ────────────────────────────────────────────

test('choosing a type loads the current deal as Deal #1 with real context', async () => {
  const { click, pick, text } = await mount();
  await click('חשבונית מס קבלה');
  await click('המשך');
  const t = text();
  assert.match(t, /דיל #27101/);
  assert.match(t, /דנה כהן/);
  assert.match(t, /הדיל הנוכחי/);
  assert.match(t, /סיור גרפיטי/);
  // …and immediately asks the source-document question.
  assert.match(t, /איזה מסמך מהדיל הזה המסמך החדש מבוסס עליו\?/);
});

test('source documents are listed with what identifies them — never a bare id', async () => {
  const { click, pick, text } = await mount();
  await click('חשבונית מס קבלה');
  await click('המשך');
  const t = text();
  assert.match(t, /חשבון עסקה מס׳ 1234/);
  assert.match(t, /₪1,000/);          // amount
  assert.match(t, /2026-08-01/);      // date
  assert.match(t, /דנה כהן/);          // customer
  assert.match(t, /פתוח/);            // status
  // A GOS-issued document whose closure GOS cannot know says so, never guesses.
  assert.match(t, /מצב סגירה לא ידוע/);
  // The escape hatch to the canonical iCount search exists.
  assert.match(t, /בחירת מסמך אחר/);
});

test('"+ הוסף דיל" is offered — the flow is N deals, not two', async () => {
  const { click, pick, text } = await mount();
  await click('חשבונית מס קבלה');
  await click('המשך');
  assert.match(text(), /\+ הוסף דיל/);
});

// ── Amount + allocation ──────────────────────────────────────────────────────

test('the amount step shows the running arithmetic, never hidden', async () => {
  const { click, pick, text } = await mount();
  await click('חשבונית מס קבלה');
  await click('המשך');
  await pick("חשבון עסקה מס׳ 1234");
  await click('המשך');
  const t = text();
  assert.match(t, /מה סכום המסמך החדש\?/);
  assert.match(t, /סכום מסמכי המקור/);
});

// ── Review ───────────────────────────────────────────────────────────────────

test('the review states type, amount, every source document and what stays open', async () => {
  const { click, pick, text } = await mount();
  await click('חשבונית מס קבלה');
  await click('המשך');
  await pick("חשבון עסקה מס׳ 1234");
  await click('המשך');
  await click('המשך'); // amount → prepares the plan
  const t = text();
  assert.match(t, /חשבונית מס קבלה/);
  assert.match(t, /דיל #27101/);
  assert.match(t, /חשבון עסקה מס׳ 1234/);
  // The partial outcome is stated in the operator's terms.
  assert.match(t, /יישארו ₪300/);
  // The confirm button returns to the composer — it does not issue.
  assert.match(t, /אישור וחזרה להפקת המסמך/);
});

test('confirming hands back the plan and issues nothing', async () => {
  let handed = null;
  const { click, pick } = await mount({ onConfirm: (p) => { handed = p; } });
  await click('חשבונית מס קבלה');
  await click('המשך');
  await pick("חשבון עסקה מס׳ 1234");
  await click('המשך');
  await click('המשך');
  await click('אישור וחזרה להפקת המסמך');
  assert.ok(handed, 'the plan reached the composer');
  assert.equal(handed.doctype, 'invrec');
  assert.deepEqual(handed.basedOnDocs, [{ doctype: 'deal', docnum: '1234' }]);
  assert.equal(handed.allocations[0].amountMinor, 70000);
  assert.match(handed.notes, /שולם 700 ₪ מתוך 1,000 ₪/);
});
