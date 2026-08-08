// The composed document itself: which lines, in which order, at what totals,
// and what the provider payload carries.
//
// `readSource` is injected so nothing here talks to iCount — the same
// injection pattern wooOrderDocument uses for `issue`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMultiDealDocument } from './multiDealDocument.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakePrisma(deals) {
  return {
    deal: { findUnique: async ({ where }) => deals.find((d) => d.id === where.id) || null },
    // The office's note settings — absent in these tests, so every deal's notes
    // come from its own content and nothing else.
    accountingDocSettings: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => data,
      upsert: async ({ create }) => create,
    },
    priceList: { findFirst: async () => null },
  };
}

const mkDeal = (id, orderNo, lines) => ({
  id,
  orderNo,
  title: `deal ${orderNo}`,
  currency: 'ILS',
  communicationLanguage: null,
  contacts: [{ isPrimary: true, contact: { firstNameHe: `לקוח${orderNo}`, lastNameHe: '', firstNameEn: '', lastNameEn: '', phones: [], emails: [] } }],
  organization: null,
  organizationUnit: null,
  product: { nameHe: 'סיור', nameEn: 'Tour' },
  location: null,
  paymentMethodRef: null,
  paymentTerm: null,
  quoteVersions: [{ isWorking: true, vatMode: 'included', lines }],
});

const line = (label, unitPriceMinor, quantity = 1) => ({
  kind: 'product', label, quantity, unitPriceMinor: BigInt(unitPriceMinor),
  vatMode: null, vatRate: null, active: true, sortOrder: 0, note: null,
});

// A source document as iCount would report it.
const source = (docnum, amountIls, rows) => async () => ({
  doctype: 'deal', docnum, doctypeLabel: 'חשבון עסקה',
  rows: rows || [{ description: `שורה של ${docnum}`, details: null, quantity: 1, unitPriceIls: amountIls, vatExempt: false }],
  amountIls, clientName: 'c', notes: null, notesFormat: 'text', notesWarning: null,
});

// ── Line ORDER ───────────────────────────────────────────────────────────────

test('lines appear deal by deal, in the operator’s order, never interleaved', async () => {
  const deals = [
    mkDeal('a', 27101, [line('סיור א', 60000), line('סדנה א', 40000)]),
    mkDeal('b', 27102, [line('סיור ב', 80000)]),
    mkDeal('c', 27103, [line('סיור ג', 70000)]),
  ];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    items: [{ dealId: 'a' }, { dealId: 'b' }, { dealId: 'c' }],
  });

  assert.deepEqual(plan.rows.map((r) => r.description), ['סיור א', 'סדנה א', 'סיור ב', 'סיור ג']);
  // Each deal reports the lines it contributed.
  assert.deepEqual(plan.perDeal.map((d) => d.rows.length), [2, 1, 1]);
  assert.deepEqual(plan.perDeal.map((d) => d.orderNo), [27101, 27102, 27103]);
});

test('reordering the items reorders the document', async () => {
  const deals = [mkDeal('a', 1, [line('A', 100)]), mkDeal('b', 2, [line('B', 100)])];
  const p1 = await composeMultiDealDocument(fakePrisma(deals), { doctype: 'invrec', items: [{ dealId: 'a' }, { dealId: 'b' }] });
  const p2 = await composeMultiDealDocument(fakePrisma(deals), { doctype: 'invrec', items: [{ dealId: 'b' }, { dealId: 'a' }] });
  assert.deepEqual(p1.rows.map((r) => r.description), ['A', 'B']);
  assert.deepEqual(p2.rows.map((r) => r.description), ['B', 'A']);
});

// ── Source documents drive the lines ─────────────────────────────────────────

test('a FULLY settled source contributes its own real lines, verbatim', async () => {
  const deals = [mkDeal('a', 1, [line('שורת הדיל', 100000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    items: [{ dealId: 'a', basedOn: { doctype: 'deal', docnum: '1234' }, allocationIls: 1000 }],
  }, {
    readSource: source('1234', 1000, [
      { description: 'סיור מהמסמך', details: null, quantity: 2, unitPriceIls: 400, vatExempt: false },
      { description: 'סדנה מהמסמך', details: null, quantity: 1, unitPriceIls: 200, vatExempt: false },
    ]),
  });
  // The SOURCE document's lines, not the deal's Builder lines.
  assert.deepEqual(plan.rows.map((r) => r.description), ['סיור מהמסמך', 'סדנה מהמסמך']);
  assert.equal(plan.perDeal[0].fullSettlement, true);
});

test('a PARTIALLY settled source contributes ONE honest on-account line', async () => {
  const deals = [mkDeal('a', 1, [line('שורת הדיל', 100000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    items: [{ dealId: 'a', basedOn: { doctype: 'deal', docnum: '1234' }, allocationIls: 700 }],
  }, { readSource: source('1234', 1000) });

  assert.equal(plan.rows.length, 1);
  // No invented product and no scaled price — it says what it is.
  assert.match(plan.rows[0].description, /חשבון עסקה 1234 — תשלום על החשבון/);
  assert.equal(plan.rows[0].unitPriceIls, 700);
  assert.equal(plan.rows[0].quantity, 1);
  assert.equal(plan.perDeal[0].fullSettlement, false);
  assert.equal(plan.perDeal[0].remainingAfterIls, 300);
  // …and the note states it in words.
  assert.match(plan.notes, /חשבון עסקה 1234 שולם 700 ₪ מתוך 1,000 ₪/);
});

test('a deal with NO source document uses its own canonical Builder lines', async () => {
  const deals = [mkDeal('a', 1, [line('סיור מהבילדר', 25000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), { doctype: 'invrec', items: [{ dealId: 'a' }] });
  assert.deepEqual(plan.rows.map((r) => r.description), ['סיור מהבילדר']);
});

test('an unreadable source is reported per deal, never fatal', async () => {
  const deals = [mkDeal('a', 1, [line('שורת הדיל', 25000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    items: [{ dealId: 'a', basedOn: { doctype: 'deal', docnum: '9999' }, allocationIls: 250 }],
  }, { readSource: async () => { throw Object.assign(new Error('x'), { code: 'icount_request_failed', reason: 'boom' }); } });
  assert.equal(plan.perDeal[0].sourceError, 'boom');
  // The deal still contributes its own lines, and the link is still recorded.
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.basedOnDocs, [{ doctype: 'deal', docnum: '9999' }]);
});

// ── The provider payload ─────────────────────────────────────────────────────

test('based_on carries EVERY selected source document, in order', async () => {
  const deals = [mkDeal('a', 1, [line('A', 100)]), mkDeal('b', 2, [line('B', 100)]), mkDeal('c', 3, [line('C', 100)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    items: [
      { dealId: 'a', basedOn: { doctype: 'deal', docnum: '1234' }, allocationIls: 1000 },
      { dealId: 'b', basedOn: { doctype: 'deal', docnum: '1240' }, allocationIls: 500 },
      { dealId: 'c', basedOn: { doctype: 'deal', docnum: '1288' }, allocationIls: 700 },
    ],
  }, { readSource: async (_p, _d, dt, dn) => (await source(dn, dn === '1234' ? 1000 : dn === '1240' ? 500 : 700)()) });

  assert.deepEqual(plan.basedOnDocs, [
    { doctype: 'deal', docnum: '1234' },
    { doctype: 'deal', docnum: '1240' },
    { doctype: 'deal', docnum: '1288' },
  ]);
  // …and the per-deal shares travel in the shape the allocation service persists.
  assert.deepEqual(plan.allocations.map((a) => a.amountMinor), [100000, 50000, 70000]);
  assert.deepEqual(plan.allocations.map((a) => a.orderNo), [1, 2, 3]);
});

test('a source type that cannot parent the target type is refused', async () => {
  const deals = [mkDeal('a', 1, [line('A', 100)])];
  await assert.rejects(
    () => composeMultiDealDocument(fakePrisma(deals), {
      doctype: 'receipt', // קבלה closes חשבונית מס, never חשבון עסקה
      items: [{ dealId: 'a', basedOn: { doctype: 'deal', docnum: '1' }, allocationIls: 10 }],
    }),
    (e) => e.code === 'base_document_type_invalid',
  );
});

// ── Amount reconciliation ────────────────────────────────────────────────────

test('the owner’s worked example reconciles exactly', async () => {
  const deals = [mkDeal('a', 27101, [line('A', 100000)]), mkDeal('b', 27102, [line('B', 80000)]), mkDeal('c', 27103, [line('C', 70000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    amountIls: 2200,
    items: [
      { dealId: 'a', basedOn: { doctype: 'deal', docnum: '1234' }, allocationIls: 1000 },
      { dealId: 'b', basedOn: { doctype: 'deal', docnum: '1240' }, allocationIls: 500 },
      { dealId: 'c', basedOn: { doctype: 'deal', docnum: '1288' }, allocationIls: 700 },
    ],
  }, { readSource: async (_p, _d, dt, dn) => (await source(dn, dn === '1234' ? 1000 : dn === '1240' ? 800 : 700)()) });

  assert.equal(plan.amountIls, 2200);
  assert.equal(plan.allocatedIls, 2200);
  assert.equal(plan.reconciliation.state, 'balanced');
  // #27102 pays 500 of an 800 document → partial, and says so.
  assert.equal(plan.perDeal[1].fullSettlement, false);
  assert.match(plan.notes, /1240 שולם 500 ₪ מתוך 800 ₪/);
});

test('over-allocation is composed, not blocked', async () => {
  const deals = [mkDeal('a', 1, [line('A', 100000)]), mkDeal('b', 2, [line('B', 70000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec',
    amountIls: 1500,
    items: [{ dealId: 'a', allocationIls: 1000 }, { dealId: 'b', allocationIls: 700 }],
  });
  assert.equal(plan.reconciliation.state, 'over');
  assert.equal(plan.reconciliation.overAllocatedMinor, 20000);
  assert.equal(plan.amountIls, 1500, 'the real document amount is untouched');
});

test('an unallocated remainder is reported, never silently absorbed', async () => {
  const deals = [mkDeal('a', 1, [line('A', 100000)])];
  const plan = await composeMultiDealDocument(fakePrisma(deals), {
    doctype: 'invrec', amountIls: 1300, items: [{ dealId: 'a', allocationIls: 1000 }],
  });
  assert.equal(plan.reconciliation.state, 'unallocated');
  assert.equal(plan.reconciliation.unallocatedMinor, 30000);
});

// ── Structural guards ────────────────────────────────────────────────────────

test('the same deal cannot be added twice', async () => {
  const deals = [mkDeal('a', 1, [line('A', 100)])];
  await assert.rejects(
    () => composeMultiDealDocument(fakePrisma(deals), { doctype: 'invrec', items: [{ dealId: 'a' }, { dealId: 'a' }] }),
    (e) => e.code === 'deal_duplicate',
  );
});

test('an empty deal list is refused', async () => {
  await assert.rejects(
    () => composeMultiDealDocument(fakePrisma([]), { doctype: 'invrec', items: [] }),
    (e) => e.code === 'deals_required',
  );
});

test('an unknown document type is refused', async () => {
  await assert.rejects(
    () => composeMultiDealDocument(fakePrisma([]), { doctype: 'nope', items: [{ dealId: 'a' }] }),
    (e) => e.code === 'invalid_doctype',
  );
});
