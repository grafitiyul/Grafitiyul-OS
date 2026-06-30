// Quote Module — Slice 2 Composer tests. Pure: no DB. `assembleComposition` is
// exercised directly on plain fixtures; the client-injected loader is exercised
// against a tiny fake client. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleComposition, composeQuoteDraftPreview, DEFAULT_QUOTE_BLOCKS, pickLang } from './composer.js';
import { ensureDraftQuoteDocument } from './quoteDocument.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
const baseDeal = (over = {}) => ({
  id: 'deal_1',
  currency: 'ILS',
  valueMinor: 540000,
  tourDate: '2026-07-10',
  tourTime: '10:00',
  participants: 25,
  product: { nameHe: 'סיור וסדנת גרפיטי', nameEn: 'Graffiti Tour', marketingDescHe: '<p>שיווק</p>', marketingDescEn: '<p>marketing</p>' },
  productVariant: { marketingDescHe: '', marketingDescEn: '', meetingPointHe: '<p>נקודת מפגש</p>', meetingPointEn: '', durationHours: 2.5 },
  location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv', meetingPointHe: '', meetingPointEn: '', marketingDescHe: '<p>עיר</p>', marketingDescEn: '<p>city</p>' },
  organization: { name: 'בית ספר X', organizationType: { quoteContentHe: '<p>בתי ספר</p>', quoteContentEn: '<p>schools</p>' } },
  organizationType: null,
  organizationSubtype: null,
  paymentTerm: { nameHe: 'שוטף+30', nameEn: 'Net 30' },
  paymentMethodRef: { nameHe: 'העברה', nameEn: 'Transfer' },
  ...over,
});

const doc = (over = {}) => ({ id: 'qd_1', dealId: 'deal_1', quoteVersionId: 'ver_1', language: 'he', displayProductName: null, personalIntro: null, compositionDraft: null, ...over });

const lines = () => [
  { kind: 'product', label: 'סיור', quantity: 25, unitPriceMinor: 20000, vatMode: 'included', vatRate: 18, overridden: false, note: 'כולל מדריך וחומרים', active: true, sortOrder: 0 },
  { kind: 'addon', label: 'תוספת', quantity: 1, unitPriceMinor: 40000, vatMode: 'inherit', vatRate: null, overridden: true, note: null, active: true, sortOrder: 1 },
  { kind: 'discount', label: 'הנחה', quantity: 1, unitPriceMinor: -10000, vatMode: 'included', vatRate: 18, overridden: false, note: 'הנחת מוסד', active: false, sortOrder: 2 },
];

const sections = () => [
  { id: 's2', category: 'faq', active: true, sortOrder: 2, titleHe: 'שאלה ב', titleEn: 'Q B', richTextHe: '<p>תשובה ב</p>', richTextEn: '<p>answer B</p>' },
  { id: 's1', category: 'faq', active: true, sortOrder: 1, titleHe: 'שאלה א', titleEn: 'Q A', richTextHe: '<p>תשובה א</p>', richTextEn: '<p>answer A</p>' },
  { id: 'c1', category: 'cancellation', active: true, sortOrder: 1, titleHe: 'ביטול', titleEn: 'Cancel', richTextHe: '<p>מדיניות</p>', richTextEn: '' },
  { id: 'w1', category: 'why_us', active: true, sortOrder: 1, titleHe: 'למה', titleEn: 'Why', richTextHe: '<p>כי</p>', richTextEn: '<p>because</p>' },
  { id: 'p1', category: 'participant_policy', active: true, sortOrder: 1, titleHe: 'משתתפים', titleEn: 'Participants', richTextHe: '<p>נהלים</p>', richTextEn: '<p>policy</p>' },
];

const compose = (over = {}) =>
  assembleComposition({
    document: over.document || doc(),
    deal: over.deal || baseDeal(),
    version: { id: 'ver_1' },
    lines: over.lines || lines(),
    quoteSections: over.quoteSections || sections(),
    lang: over.lang || (over.document || doc()).language,
  });

const blockByKey = (model, key) => model.blocks.find((b) => b.key === key);

// ── 1. default block order ───────────────────────────────────────────────────
test('composer: produces the approved default block order', () => {
  const model = compose();
  assert.deepEqual(
    model.blocks.map((b) => b.key),
    DEFAULT_QUOTE_BLOCKS.map((b) => b.key),
  );
  // sortOrder is dense + ascending
  model.blocks.forEach((b, i) => assert.equal(b.sortOrder, i));
});

// ── 2. language from Contact.communicationLanguage (end-to-end via the service) ─
test('composer: language reflects the contact-derived document language', async () => {
  // Slice-1 service resolves language from the payer contact, then the composer uses it.
  const state = { versions: [], docs: [] };
  let vSeq = 0;
  const client = {
    deal: { findUnique: async ({ where, include }) => (where.id === 'deal_1' ? (include ? baseDeal() : { id: 'deal_1', communicationLanguage: null, quoteEmailIntro: null, contacts: [{ roles: ['payer'], isPrimary: false, contact: { communicationLanguage: 'en' } }] }) : null) },
    quoteVersion: {
      findFirst: async () => state.versions[0] || null,
      findUnique: async ({ where }) => state.versions.find((v) => v.id === where.id) || null,
      create: async ({ data }) => { const v = { id: `ver_${++vSeq}`, ...data }; state.versions.push(v); return v; },
    },
    quoteDocument: {
      findFirst: async () => state.docs[0] || null,
      findUnique: async ({ where }) => state.docs.find((d) => d.id === where.id) || null,
      create: async ({ data }) => { const d = { id: 'qd_1', createdAt: new Date(), ...data }; state.docs.push(d); return d; },
    },
    quoteLine: { findMany: async () => lines() },
    quoteSection: { findMany: async () => sections() },
  };
  const ensured = await ensureDraftQuoteDocument(client, 'deal_1');
  assert.equal(ensured.doc.language, 'en', 'language resolved from payer contact');
  const r = await composeQuoteDraftPreview(client, ensured.doc.id);
  assert.equal(r.model.language, 'en', 'composer uses the contact-derived language');
});

// ── 3. missing-language content → structured warnings (no auto-translate) ──────
test('composer: missing English content produces structured warnings', () => {
  const model = compose({ lang: 'en' });
  // cancellation section c1 has empty richTextEn → warning
  const cancelWarn = model.warnings.find((w) => w.blockKey === 'cancellation' && w.field.startsWith('richText'));
  assert.ok(cancelWarn, 'cancellation En missing warns');
  assert.equal(cancelWarn.code, 'missing_content');
  assert.equal(cancelWarn.language, 'en');
});

test('composer: Hebrew quote with full He content has no content warnings', () => {
  const model = compose({ lang: 'he' });
  const contentWarns = model.warnings.filter((w) => w.field.startsWith('richText') || w.field === 'marketingDesc' || w.field === 'quoteContent');
  assert.equal(contentWarns.length, 0);
});

test('composer: missing product marketing in the language warns', () => {
  const deal = baseDeal();
  deal.product.marketingDescEn = '';
  deal.productVariant.marketingDescEn = '';
  const model = compose({ deal, lang: 'en' });
  assert.ok(model.warnings.some((w) => w.blockKey === 'product_marketing'), 'product marketing En missing warns');
});

// ── 4. Pricing block uses QuoteLines + row notes, frozen total ────────────────
test('composer: pricing renders frozen line data incl. row notes and grossMinor', () => {
  const model = compose();
  const pricing = blockByKey(model, 'pricing').data;
  assert.equal(pricing.currency, 'ILS');
  assert.equal(pricing.totals.grossMinor, 540000, 'gross is the frozen Deal.valueMinor (not recalculated)');
  const product = pricing.lines.find((l) => l.kind === 'product');
  assert.equal(product.quantity, 25);
  assert.equal(product.unitPriceMinor, 20000);
  assert.equal(product.lineTotalMinor, 500000, 'line total = qty × frozen unit');
  assert.equal(product.note, 'כולל מדריך וחומרים', 'yellow row note is carried through');
  assert.equal(product.vatMode, 'included');
  const addon = pricing.lines.find((l) => l.kind === 'addon');
  assert.equal(addon.overridden, true, 'override flag preserved');
});

// ── 5. inactive lines excluded + counted ──────────────────────────────────────
test('composer: inactive QuoteLines are excluded from the offer and counted', () => {
  const pricing = blockByKey(compose(), 'pricing').data;
  assert.equal(pricing.lines.length, 2, 'only active lines rendered');
  assert.ok(!pricing.lines.some((l) => l.kind === 'discount'), 'inactive discount excluded');
  assert.equal(pricing.excludedInactive, 1);
});

// ── 6. display product name override affects ALL references ───────────────────
test('composer: displayProductName override flows to hero, tour details, and the pricing product line', () => {
  const override = 'השתלמות מקצועית באומנות אורבנית';
  const model = compose({ document: doc({ displayProductName: override }) });
  assert.equal(model.displayProductName, override);
  assert.equal(blockByKey(model, 'hero').data.productName, override);
  assert.equal(blockByKey(model, 'tour_details').data.productName, override);
  const product = blockByKey(model, 'pricing').data.lines.find((l) => l.kind === 'product');
  assert.equal(product.label, override, 'pricing product line shows the override (display-only)');
});

test('composer: without an override, the product name resolves from the catalog in the quote language', () => {
  assert.equal(blockByKey(compose({ lang: 'en' }), 'hero').data.productName, 'Graffiti Tour');
  assert.equal(blockByKey(compose({ lang: 'he' }), 'hero').data.productName, 'סיור וסדנת גרפיטי');
});

// ── 7. content order deterministic ────────────────────────────────────────────
test('composer: section content is deterministically ordered (sortOrder, stable)', () => {
  const a = blockByKey(compose(), 'faq').data.items.map((i) => i.id);
  const b = blockByKey(compose(), 'faq').data.items.map((i) => i.id);
  assert.deepEqual(a, ['s1', 's2'], 'ordered by sortOrder');
  assert.deepEqual(a, b, 'stable across runs');
});

// ── override layer: stored compositionDraft order + hidden are respected ──────
test('composer: stored compositionDraft controls order and hides blocks (no warnings for hidden)', () => {
  const document = doc({
    language: 'en',
    compositionDraft: { blocks: [{ key: 'pricing' }, { key: 'cancellation', hidden: true }, { key: 'hero' }] },
  });
  const model = compose({ document, lang: 'en' });
  assert.deepEqual(model.blocks.map((b) => b.key), ['pricing', 'cancellation', 'hero']);
  assert.equal(blockByKey(model, 'cancellation').hidden, true);
  // cancellation En content is missing, but it is hidden → must NOT warn.
  assert.ok(!model.warnings.some((w) => w.blockKey === 'cancellation'), 'hidden block raises no warning');
});

// ── pickLang unit ─────────────────────────────────────────────────────────────
test('pickLang: selects by language, returns null on empty, never cross-falls back', () => {
  assert.equal(pickLang('שלום', 'hello', 'en'), 'hello');
  assert.equal(pickLang('שלום', 'hello', 'he'), 'שלום');
  assert.equal(pickLang('שלום', '', 'en'), null, 'empty En → null (no He fallback)');
  assert.equal(pickLang('  ', 'hello', 'he'), null, 'whitespace-only → null');
});
