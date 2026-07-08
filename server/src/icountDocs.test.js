import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_TYPES,
  buildDocumentDefaults,
  totalsForRows,
  allocationRequirement,
  buildPaymentBlocks,
  normalizeBaseDocItems,
  grossFromDocInfo,
  vatIdWriteTarget,
} from './icountDocs.js';

// Pure domain logic only — the iCount HTTP client and prisma writes are out of
// scope here (same convention as dealPayment.test.js).

const baseDeal = {
  id: 'd1',
  title: 'סיור גרפיטי',
  currency: 'ILS',
  valueMinor: 585000n, // ₪5,850 gross
  product: { nameHe: 'סיור גרפיטי בפלורנטין' },
  organization: { name: 'חברת אקמי', taxId: '514123456', address: 'תל אביב', financeEmail: 'finance@acme.co.il' },
  organizationUnit: null,
  paymentMethodRef: { nameHe: 'העברה בנקאית' },
  paymentTerm: { nameHe: 'שוטף+30' },
  contacts: [
    {
      contact: {
        firstNameHe: 'דנה',
        lastNameHe: 'לוי',
        firstNameEn: '',
        lastNameEn: '',
        phones: [{ value: '0501234567' }],
        emails: [{ value: 'dana@acme.co.il' }],
      },
    },
  ],
  quoteVersions: [],
};

test('doc types: the five Hebrew document types with correct linking rules', () => {
  assert.deepEqual(DOC_TYPES.map((t) => t.key), ['deal', 'invoice', 'invrec', 'receipt', 'refund']);
  const refund = DOC_TYPES.find((t) => t.key === 'refund');
  assert.equal(refund.baseRequired, true);
  assert.deepEqual(refund.baseTypes, ['invoice', 'invrec']);
  const receipt = DOC_TYPES.find((t) => t.key === 'receipt');
  assert.deepEqual(receipt.baseTypes, ['invoice']);
  assert.equal(receipt.paymentsAllowed, true);
});

test('doc types: money-recording docs REQUIRE a payment; the rest never do', () => {
  const required = DOC_TYPES.filter((t) => t.paymentsRequired).map((t) => t.key);
  assert.deepEqual(required, ['invrec', 'receipt']);
  // Guard: a type must never require payments without allowing them.
  for (const t of DOC_TYPES) if (t.paymentsRequired) assert.equal(t.paymentsAllowed, true);
});

test('defaults: organization is the default customer, org tax id + finance email win', () => {
  const d = buildDocumentDefaults(baseDeal);
  assert.equal(d.customer.defaultMode, 'organization');
  assert.equal(d.customer.organizationName, 'חברת אקמי');
  assert.equal(d.customer.contactName, 'דנה לוי');
  assert.equal(d.customer.vatId, '514123456');
  assert.equal(d.customer.email, 'finance@acme.co.il');
  assert.equal(d.customer.phone, '0501234567');
});

test('defaults: no organization → contact mode, contact email', () => {
  const d = buildDocumentDefaults({ ...baseDeal, organization: null });
  assert.equal(d.customer.defaultMode, 'contact');
  assert.equal(d.customer.email, 'dana@acme.co.il');
  assert.equal(d.customer.vatId, null);
});

test('defaults: no quote lines → single row from deal value (gross major units)', () => {
  const d = buildDocumentDefaults(baseDeal);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].description, 'סיור גרפיטי בפלורנטין');
  assert.equal(d.rows[0].unitPriceIls, 5850);
});

test('defaults: quote lines become rows; excluded-VAT lines are normalized to inclusive', () => {
  const d = buildDocumentDefaults({
    ...baseDeal,
    quoteVersions: [
      {
        lines: [
          { label: 'סיור', quantity: 2, unitPriceMinor: 100000n, vatMode: 'included', vatRate: null },
          { label: 'תוספת', quantity: 1, unitPriceMinor: 10000n, vatMode: 'excluded', vatRate: 18 },
        ],
      },
    ],
  });
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[0].unitPriceIls, 1000); // included passes through
  assert.equal(d.rows[1].unitPriceIls, 118); // 100 + 18% VAT
});

test('totals: gross and before-VAT derived from inclusive rows', () => {
  const { grossIls, beforeVatIls } = totalsForRows(
    [{ quantity: 2, unitPriceIls: 2950 }],
    18,
  );
  assert.equal(grossIls, 5900);
  assert.equal(beforeVatIls, 5000);
});

test('allocation: tax invoice at/above the before-VAT threshold requires a valid vat id', () => {
  // ₪5,900 gross @18% = exactly ₪5,000 before VAT → at the threshold.
  const rows = [{ quantity: 1, unitPriceIls: 5900 }];
  const missing = allocationRequirement({ doctype: 'invoice', rows, vatId: '' });
  assert.equal(missing.required, true);
  assert.deepEqual(missing.missing, ['vatId']);
  const ok = allocationRequirement({ doctype: 'invoice', rows, vatId: '514123456' });
  assert.deepEqual(ok.missing, []);
});

test('allocation: below threshold or non-tax-invoice doctypes → no requirement', () => {
  const smallRows = [{ quantity: 1, unitPriceIls: 5899 }]; // ₪4,999.15 before VAT
  assert.equal(allocationRequirement({ doctype: 'invoice', rows: smallRows, vatId: '' }), null);
  const bigRows = [{ quantity: 1, unitPriceIls: 59000 }];
  assert.equal(allocationRequirement({ doctype: 'receipt', rows: bigRows, vatId: '' }), null);
  assert.equal(allocationRequirement({ doctype: 'deal', rows: bigRows, vatId: '' }), null);
  // refund IS a tax invoice for allocation purposes.
  assert.equal(allocationRequirement({ doctype: 'refund', rows: bigRows, vatId: '' }).required, true);
});

test('payments: methods map onto the verified iCount blocks', () => {
  const body = buildPaymentBlocks([
    { method: 'cash', amount: 100 },
    { method: 'cc', amount: 200, date: '2026-07-01', cardType: 'VISA', cardLast4: '1234', installments: 3, holderName: 'דנה', reference: 'A1' },
    { method: 'banktransfer', amount: 300, date: '2026-07-02', reference: '123-456' },
    { method: 'cheque', amount: 50, bank: 12, branch: 1, account: '99', reference: '777' },
    { method: 'cheque', amount: 60, bank: 12, branch: 1, account: '99', reference: '778' },
  ]);
  assert.deepEqual(body.cash, { sum: '100' });
  assert.equal(body.cc.sum, '200');
  assert.equal(body.cc.num_of_payments, 3);
  assert.equal(body.cc.confirmation_code, 'A1');
  assert.equal(body.banktransfer.account, '123-456');
  assert.equal(body.cheques.length, 2); // cheques accumulate
});

test('payments: duplicate non-cheque method / bad amount / unknown method are rejected', () => {
  assert.throws(() => buildPaymentBlocks([{ method: 'cash', amount: 1 }, { method: 'cash', amount: 2 }]), /payment_method_duplicate/);
  assert.throws(() => buildPaymentBlocks([{ method: 'cash', amount: 0 }]), /payment_amount_invalid/);
  assert.throws(() => buildPaymentBlocks([{ method: 'bit', amount: 10 }]), /payment_method_invalid/);
});

test('defaults: per-mode tax ids — org ח.פ vs contact ת.ז, contact fallback when no org', () => {
  const withContactTz = {
    ...baseDeal,
    contacts: [{ contact: { ...baseDeal.contacts[0].contact, taxId: '039876543' } }],
  };
  const d = buildDocumentDefaults(withContactTz);
  assert.equal(d.customer.vatIdOrganization, '514123456');
  assert.equal(d.customer.vatIdContact, '039876543');
  assert.equal(d.customer.vatId, '514123456'); // default mode = organization
  const noOrg = buildDocumentDefaults({ ...withContactTz, organization: null });
  assert.equal(noOrg.customer.vatId, '039876543'); // contact mode default
});

// Item fixtures mirror the LIVE doc/info payload shape (verified 2026-07-08):
// string quantities, NET high-precision unitprice, per-item tax_rate/tax_exempt.
test('base items: copied EXACTLY — every row kept, net price → inclusive per its own tax_rate', () => {
  const rows = normalizeBaseDocItems([
    { item_id: '1', description: 'סיור גרפיטי', long_description: '', unitprice: '1000', quantity: '2', tax_rate: 18, tax_exempt: '0' },
    { item_id: '2', description: 'סדנה', long_description: 'כולל ציוד', unitprice: '500', quantity: '1', tax_rate: 18, tax_exempt: '0' },
    { item_id: '3', description: 'תרומה', long_description: '', unitprice: '100', quantity: '1', tax_rate: 18, tax_exempt: '1' },
  ]);
  assert.deepEqual(rows, [
    { description: 'סיור גרפיטי', details: null, quantity: 2, unitPriceIls: 1180 },
    { description: 'סדנה', details: 'כולל ציוד', quantity: 1, unitPriceIls: 590 },
    { description: 'תרומה', details: null, quantity: 1, unitPriceIls: 100 }, // exempt stays net
  ]);
});

test('base items: document 54526 regression — high-precision net converts to the exact inclusive price', () => {
  // The real item behind the QA bug: 0.0084745762711864 × 1.18 = 0.01.
  const rows = normalizeBaseDocItems([
    { description: 'סיור וסדנת גרפיטי', long_description: '', unitprice: '0.0084745762711864', quantity: '1', tax_rate: 18, tax_exempt: '0' },
  ]);
  assert.deepEqual(rows, [
    { description: 'סיור וסדנת גרפיטי', details: null, quantity: 1, unitPriceIls: 0.01 },
  ]);
});

test('base items: unitprice_incl preferred when present; no items → empty (never synthesized)', () => {
  assert.deepEqual(normalizeBaseDocItems([{ description: 'א', unitprice_incl: 118, unitprice: 100, quantity: 1 }]), [
    { description: 'א', details: null, quantity: 1, unitPriceIls: 118 },
  ]);
  assert.deepEqual(normalizeBaseDocItems([]), []);
  assert.deepEqual(normalizeBaseDocItems(undefined), []);
});

test('grossFromDocInfo: totalwithvat wins; totalsum+totalvat is the fallback pair', () => {
  assert.equal(grossFromDocInfo({ totalwithvat: 118.5 }), 118.5);
  assert.equal(grossFromDocInfo({ totalsum: 100, totalvat: 18 }), 118);
  assert.equal(grossFromDocInfo({ totalsum: 100 }), 100);
  assert.equal(grossFromDocInfo({}), null);
});

test('vatIdWriteTarget: unit beats org; contact mode targets the primary contact', () => {
  const deal = {
    organizationId: 'org1',
    organizationUnitId: 'unit1',
    contacts: [{ contact: { id: 'c1' } }],
  };
  assert.deepEqual(vatIdWriteTarget(deal, 'organization'), { model: 'organizationUnit', id: 'unit1' });
  assert.deepEqual(vatIdWriteTarget({ ...deal, organizationUnitId: null }, 'organization'), { model: 'organization', id: 'org1' });
  assert.deepEqual(vatIdWriteTarget(deal, 'contact'), { model: 'contact', id: 'c1' });
  assert.deepEqual(
    vatIdWriteTarget({ organizationId: null, organizationUnitId: null, contacts: [{ contact: { id: 'c1' } }] }, 'organization'),
    { model: 'contact', id: 'c1' },
  );
  assert.equal(vatIdWriteTarget({ contacts: [] }, 'contact'), null);
});

test('follow-up restriction map: base חשבונית מס allows only קבלה/זיכוי — never חשבונית מס קבלה', () => {
  const followUpsFor = (base) => DOC_TYPES.filter((t) => t.baseTypes.includes(base)).map((t) => t.key);
  assert.deepEqual(followUpsFor('deal'), ['invoice', 'invrec']);
  assert.deepEqual(followUpsFor('invoice'), ['receipt', 'refund']);
  assert.deepEqual(followUpsFor('invrec'), ['refund']);
  assert.deepEqual(followUpsFor('receipt'), []);
});
