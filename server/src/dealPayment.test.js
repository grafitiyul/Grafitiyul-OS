import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newPaymentToken,
  pickPaymentContact,
  buildPaymentSnapshot,
  linkMatchesSnapshot,
  buildSaleItems,
  salePaypageId,
} from './dealPayment.js';
import { GENERIC_PRODUCT_LINE_HE } from './displayFallbacks.js';

// ── newPaymentToken ──────────────────────────────────────────────────────────
test('newPaymentToken: URL-safe and unique across many generations', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = newPaymentToken();
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.ok(t.length >= 24, 'high-entropy token');
    assert.ok(!seen.has(t), 'no collisions');
    seen.add(t);
  }
});

// ── pickPaymentContact ───────────────────────────────────────────────────────
const dc = (over) => ({ receivePaymentLinks: false, contact: {}, ...over });

test('pickPaymentContact: receivePaymentLinks wins over list order', () => {
  const flagged = dc({ receivePaymentLinks: true, contact: { firstNameHe: 'ב' } });
  const first = dc({ contact: { firstNameHe: 'א' } });
  assert.equal(pickPaymentContact([first, flagged]), flagged);
});

test('pickPaymentContact: falls back to the first (primary-ordered) contact', () => {
  const first = dc({ contact: { firstNameHe: 'א' } });
  assert.equal(pickPaymentContact([first, dc({})]), first);
  assert.equal(pickPaymentContact([]), null);
  assert.equal(pickPaymentContact(undefined), null);
});

// ── buildPaymentSnapshot ─────────────────────────────────────────────────────
const baseDeal = () => ({
  title: 'סיור גרפיטי לחברה',
  valueMinor: 540000n,
  currency: 'ILS',
  product: { nameHe: 'סיור גרפיטי' },
  contacts: [
    dc({
      contact: {
        firstNameHe: 'רחל',
        lastNameHe: 'כהן',
        phones: [{ value: '0501234567' }],
        emails: [{ value: 'rachel@example.com' }],
      },
    }),
  ],
});

test('buildPaymentSnapshot: full deal → all prefill fields', () => {
  const s = buildPaymentSnapshot(baseDeal());
  assert.deepEqual(s, {
    amountMinor: 540000n,
    currency: 'ILS',
    vatExempt: false,
    productName: 'סיור גרפיטי',
    firstName: 'רחל',
    lastName: 'כהן',
    customerName: 'רחל כהן',
    customerPhone: '0501234567',
    customerEmail: 'rachel@example.com',
  });
});

test('buildPaymentSnapshot: linked organization wins the display name; contact person still prefills', () => {
  const d = { ...baseDeal(), organization: { name: 'חברת הייטק בע"מ' } };
  const s = buildPaymentSnapshot(d);
  assert.equal(s.customerName, 'חברת הייטק בע"מ');
  // The payer's personal fields stay the contact's — they prefill the form.
  assert.equal(s.firstName, 'רחל');
  assert.equal(s.lastName, 'כהן');
  assert.equal(s.customerPhone, '0501234567');
});

test('buildPaymentSnapshot: no organization → contact full name (existing behavior)', () => {
  assert.equal(buildPaymentSnapshot(baseDeal()).customerName, 'רחל כהן');
});

test('buildPaymentSnapshot: privacy — no product → generic line, NEVER Deal.title', () => {
  const d = { ...baseDeal(), title: 'ליד חדש - לילי', product: null };
  const s = buildPaymentSnapshot(d);
  assert.equal(s.productName, GENERIC_PRODUCT_LINE_HE);
  const text = JSON.stringify(s, (k, v) => (typeof v === 'bigint' ? String(v) : v));
  assert.ok(!text.includes('ליד חדש'), 'internal CRM title must not reach the payment page');
});

test('buildPaymentSnapshot: no contacts → null customer fields (optional prefill)', () => {
  const d = { ...baseDeal(), contacts: [] };
  const s = buildPaymentSnapshot(d);
  assert.equal(s.customerName, null);
  assert.equal(s.customerPhone, null);
  assert.equal(s.customerEmail, null);
  assert.equal(s.firstName, '');
});

test('buildPaymentSnapshot: Hebrew name missing → English fallback', () => {
  const d = { ...baseDeal(), contacts: [dc({ contact: { firstNameEn: 'Rachel', lastNameEn: 'Cohen' } })] };
  const s = buildPaymentSnapshot(d);
  assert.equal(s.customerName, 'Rachel Cohen');
});

// ── linkMatchesSnapshot (the regenerate-only-on-drift gate) ──────────────────
const matchingLink = () => ({
  amountMinor: 540000n,
  currency: 'ILS',
  productName: 'סיור גרפיטי',
  customerName: 'רחל כהן',
  customerPhone: '0501234567',
  customerEmail: 'rachel@example.com',
});

test('linkMatchesSnapshot: unchanged deal → reuse (no regenerate)', () => {
  assert.equal(linkMatchesSnapshot(matchingLink(), buildPaymentSnapshot(baseDeal())), true);
});

test('linkMatchesSnapshot: no active link → regenerate', () => {
  assert.equal(linkMatchesSnapshot(null, buildPaymentSnapshot(baseDeal())), false);
});

test('linkMatchesSnapshot: each relevant drift forces a new link', () => {
  const snap = buildPaymentSnapshot(baseDeal());
  for (const [field, value] of [
    ['amountMinor', 600000n],
    ['productName', 'סיור אחר'],
    ['customerName', 'דנה לוי'],
    ['customerPhone', '0529999999'],
    ['customerEmail', 'other@example.com'],
    ['currency', 'USD'],
    ['vatExempt', true],
  ]) {
    assert.equal(linkMatchesSnapshot({ ...matchingLink(), [field]: value }, snap), false, `${field} drift`);
  }
});

test('linkMatchesSnapshot: BigInt/number amount representations compare equal', () => {
  // Prisma returns BigInt; serialized copies may carry numbers — same value must match.
  assert.equal(linkMatchesSnapshot({ ...matchingLink(), amountMinor: 540000 }, buildPaymentSnapshot(baseDeal())), true);
});

// ── VAT truth on the payment link (production bug: deal #26617) ──────────────
// Working Builder: QuoteVersion.vatMode='exempt', one product line ₪1,000.00
// with vatMode='inherit'. Before the fix the link was generated with no VAT
// semantics at all — the iCount page presented ₪847.46 + ₪152.54 מע"מ.
const exemptDeal26617 = () => ({
  ...baseDeal(),
  valueMinor: 100000n,
  quoteVersions: [
    { id: 'cmsdf63ju000tagpqt2hfanc6', vatMode: 'exempt', lines: [{ vatMode: 'inherit' }] },
  ],
});

test('buildPaymentSnapshot: exempt Builder (inherit lines) → vatExempt snapshot, exempt total kept verbatim', () => {
  const s = buildPaymentSnapshot(exemptDeal26617());
  assert.equal(s.vatExempt, true);
  assert.equal(s.amountMinor, 100000n, 'the exempt total — no VAT added or implied');
});

test('linkMatchesSnapshot: pre-fix link (vatExempt undefined/false) drifts against an exempt snapshot → regenerates', () => {
  const preFixLink = { ...matchingLink(), amountMinor: 100000n };
  assert.equal(linkMatchesSnapshot(preFixLink, buildPaymentSnapshot(exemptDeal26617())), false);
});

// ── buildSaleItems: preview === payload by construction ──────────────────────
test('buildSaleItems: exempt → exact amount + tax_exempt (what iCount receives)', () => {
  const s = buildPaymentSnapshot(exemptDeal26617());
  assert.deepEqual(buildSaleItems(s, s.productName), [
    { quantity: 1, description: 'סיור גרפיטי', unitprice_incl: 1000, tax_exempt: 1 },
  ]);
});

test('buildSaleItems: included/excluded → gross passes through ONCE, no tax flag, no re-add', () => {
  // Deal.valueMinor is the Builder gross — VAT was already applied exactly once
  // by splitVat. The payload must carry that number verbatim as unitprice_incl.
  for (const mode of ['included', 'excluded']) {
    const d = { ...baseDeal(), quoteVersions: [{ id: 'v', vatMode: mode, lines: [{ vatMode: 'inherit' }] }] };
    const s = buildPaymentSnapshot(d);
    assert.equal(s.vatExempt, false, `${mode} is not exempt`);
    const items = buildSaleItems(s, s.productName);
    assert.equal(items[0].unitprice_incl, 5400, `${mode}: payload amount === snapshot amount (₪5,400.00)`);
    assert.equal('tax_exempt' in items[0], false, `${mode}: no exempt flag`);
  }
});

test('buildSaleItems: payment-page amount equals payment payload amount (same snapshot feeds both)', () => {
  const s = buildPaymentSnapshot(exemptDeal26617());
  const items = buildSaleItems(s, s.productName);
  // The stored link row (page) and the generate_sale item (payload) both come
  // from `s.amountMinor` — a drift between them is impossible by construction.
  assert.equal(BigInt(Math.round(items[0].unitprice_incl * 100)), s.amountMinor);
});

// ── salePaypageId: exempt sales must go to the exempt paypage ────────────────
test('salePaypageId: routes by VAT truth and fails loudly when the exempt page is unconfigured', () => {
  const prevDefault = process.env.ICOUNT_DEFAULT_PAYPAGE_ID;
  const prevExempt = process.env.ICOUNT_EXEMPT_PAYPAGE_ID;
  try {
    process.env.ICOUNT_DEFAULT_PAYPAGE_ID = '3';
    process.env.ICOUNT_EXEMPT_PAYPAGE_ID = '9';
    assert.equal(salePaypageId(false), '3');
    assert.equal(salePaypageId(true), '9');
    delete process.env.ICOUNT_EXEMPT_PAYPAGE_ID;
    assert.throws(() => salePaypageId(true), (e) => e.code === 'icount_exempt_paypage_not_configured');
    // an exempt misconfiguration must never fall back to the VAT page
    delete process.env.ICOUNT_DEFAULT_PAYPAGE_ID;
    assert.throws(() => salePaypageId(false), (e) => e.code === 'icount_paypage_not_configured');
  } finally {
    if (prevDefault === undefined) delete process.env.ICOUNT_DEFAULT_PAYPAGE_ID;
    else process.env.ICOUNT_DEFAULT_PAYPAGE_ID = prevDefault;
    if (prevExempt === undefined) delete process.env.ICOUNT_EXEMPT_PAYPAGE_ID;
    else process.env.ICOUNT_EXEMPT_PAYPAGE_ID = prevExempt;
  }
});
