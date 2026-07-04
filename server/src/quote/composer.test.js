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

const doc = (over = {}) => ({ id: 'qd_1', dealId: 'deal_1', quoteVersionId: 'ver_1', language: 'he', displayProductName: null, compositionDraft: null, ...over });

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
    sharedContent: over.sharedContent,
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
    // No saved global layout → composer uses DEFAULT_LAYOUT (behaviour unchanged).
    quoteTemplate: { findUnique: async () => null },
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
  const keys = model.blocks.map((b) => b.key);
  // Hero is the document header — always forced first regardless of stored order.
  assert.equal(keys[0], 'hero');
  // The saved keys keep their RELATIVE order (pricing before cancellation)…
  assert.ok(keys.indexOf('pricing') < keys.indexOf('cancellation'), 'stored relative order preserved');
  // …and canonical blocks missing from an older draft are reconciled back in.
  assert.ok(keys.includes('program') && keys.includes('video'), 'missing canonical blocks reconciled in');
  assert.equal(blockByKey(model, 'cancellation').hidden, true);
  // cancellation En content is missing, but it is hidden → must NOT warn.
  assert.ok(!model.warnings.some((w) => w.blockKey === 'cancellation'), 'hidden block raises no warning');
});

// ── override layer: content overrides applied + source metadata (Slice 3) ────
test('composer: HTML override replaces section content and clears its warning', () => {
  const document = doc({ language: 'en', overrideState: { blocks: { faq: { html: '<p>custom FAQ</p>' } } } });
  const model = compose({ document, lang: 'en' });
  const faq = blockByKey(model, 'faq');
  assert.equal(faq.data.customHtml, '<p>custom FAQ</p>', 'section block shows custom override html');
  assert.equal(faq.overridden, true);
  assert.ok(!model.warnings.some((w) => w.blockKey === 'faq'), 'override supplies content → no warning');
});

test('composer: HTML override replaces a single-html content block', () => {
  const document = doc({ overrideState: { blocks: { classification: { html: '<p>נוסח מותאם</p>' } } } });
  const model = compose({ document });
  const cls = blockByKey(model, 'classification');
  assert.equal(cls.data.html, '<p>נוסח מותאם</p>');
  assert.equal(cls.overridden, true);
});

test('composer: title override is applied to a content block', () => {
  const document = doc({ overrideState: { blocks: { why_grafitiyul: { title: 'כותרת מותאמת' } } } });
  const model = compose({ document });
  assert.equal(blockByKey(model, 'why_grafitiyul').data.title, 'כותרת מותאמת');
  assert.equal(blockByKey(model, 'why_grafitiyul').overridden, true);
});

test('composer: every block carries source metadata; displayProductName override marks blocks', () => {
  const model = compose({ document: doc({ displayProductName: 'X' }) });
  assert.equal(blockByKey(model, 'pricing').source, 'QuoteVersion (Builder)');
  assert.equal(blockByKey(model, 'tour_details').source, 'Deal · Product · Location');
  assert.equal(model.displayProductNameOverridden, true);
  assert.equal(blockByKey(model, 'hero').overridden, true);
  assert.equal(blockByKey(model, 'tour_details').overridden, true);
});

// ── edit-at-source targets (v2 redesign) ─────────────────────────────────────
test('composer: each block carries a contextual editTarget (route to source)', () => {
  const model = compose({ deal: baseDeal({ productId: 'p1', locationId: 'loc1', organizationTypeId: 'ot1' }) });
  assert.deepEqual(blockByKey(model, 'pricing').editTarget, { kind: 'builder', label: 'ערוך תמחור', dialog: true });
  assert.equal(blockByKey(model, 'tour_details').editTarget.kind, 'deal');
  assert.equal(blockByKey(model, 'tour_details').editTarget.label, 'ערוך פרטי הסיור');
  assert.equal(blockByKey(model, 'product_marketing').editTarget.kind, 'product');
  assert.equal(blockByKey(model, 'product_marketing').editTarget.id, 'p1');
  assert.equal(blockByKey(model, 'faq').editTarget.kind, 'quoteSections');
  assert.equal(blockByKey(model, 'faq').editTarget.category, 'faq');
  assert.equal(blockByKey(model, 'program').editTarget.kind, 'product');
  assert.equal(blockByKey(model, 'program').editTarget.id, 'p1');
});

// ── Shared Content dual-read (Slice 2) ───────────────────────────────────────
const tour = (model) => blockByKey(model, 'tour_details').data;

test('dual-read: a resolved Shared Content meeting point wins over the legacy variant column', () => {
  const sc = { meetingPoint: { bodyHe: '<p>מפגש משותף</p>', bodyEn: '<p>shared</p>' } };
  const model = compose({ sharedContent: sc });
  assert.equal(tour(model).meetingPoint, '<p>מפגש משותף</p>', 'shared content is the source of truth');
});

test('dual-read: falls back to the legacy variant column when no Shared Content exists', () => {
  const model = compose({ sharedContent: { meetingPoint: null } });
  assert.equal(tour(model).meetingPoint, '<p>נקודת מפגש</p>', 'legacy variant meetingPointHe');
});

test('dual-read: undefined sharedContent reproduces pre-Slice-2 behaviour (legacy columns)', () => {
  const model = compose(); // no sharedContent key at all
  assert.equal(tour(model).meetingPoint, '<p>נקודת מפגש</p>');
});

test('dual-read: legacy fallback prefers variant, then location column', () => {
  const deal = baseDeal({
    productVariant: { meetingPointHe: '', meetingPointEn: '', durationHours: 2 },
    location: { nameHe: 'תל אביב', meetingPointHe: '<p>מפגש עירוני</p>', meetingPointEn: '' },
  });
  const model = compose({ deal, sharedContent: { meetingPoint: null } });
  assert.equal(tour(model).meetingPoint, '<p>מפגש עירוני</p>', 'location column used when variant empty');
});

test('dual-read: Shared Content HTML is passed through verbatim (renderer sanitizes, not the composer)', () => {
  const html = '<p>קו 1</p><ul><li>פריט</li></ul>';
  const model = compose({ sharedContent: { meetingPoint: { bodyHe: html, bodyEn: '' } } });
  assert.equal(tour(model).meetingPoint, html, 'no escaping / mangling of stored HTML');
});

test('dual-read: English quote picks the En side of the Shared Content block', () => {
  const model = compose({
    document: doc({ language: 'en' }),
    sharedContent: { meetingPoint: { bodyHe: '<p>עברית</p>', bodyEn: '<p>English MP</p>' } },
  });
  assert.equal(tour(model).meetingPoint, '<p>English MP</p>');
});

// ── pickLang unit ─────────────────────────────────────────────────────────────
test('pickLang: selects by language, returns null on empty, never cross-falls back', () => {
  assert.equal(pickLang('שלום', 'hello', 'en'), 'hello');
  assert.equal(pickLang('שלום', 'hello', 'he'), 'שלום');
  assert.equal(pickLang('שלום', '', 'en'), null, 'empty En → null (no He fallback)');
  assert.equal(pickLang('  ', 'hello', 'he'), null, 'whitespace-only → null');
});

// ── Hero "Prepared for": contact name resolves in EITHER preview language ──────
// Other-language contact names are optional and stored as '' (routes/contacts.js).
// The cover's "Prepared for" VALUE must not disappear when the quote language is
// the one the contact lacks — the value is the same person; only the LABEL localizes.
test('composer: hero customerName falls back across languages (Hebrew-only contact)', () => {
  const contacts = [{ isPrimary: true, roles: [], contact: { firstNameHe: 'אלינור', lastNameHe: 'קיסלוב', firstNameEn: '', lastNameEn: '' } }];
  const he = blockByKey(compose({ deal: baseDeal({ contacts }), lang: 'he' }), 'hero').data;
  const en = blockByKey(compose({ deal: baseDeal({ contacts }), lang: 'en' }), 'hero').data;
  assert.equal(he.customerName, 'אלינור קיסלוב');
  assert.equal(en.customerName, 'אלינור קיסלוב', 'English preview still shows the (Hebrew) contact name');
});

test('composer: hero customerName prefers the quote-language name when both exist', () => {
  const contacts = [{ isPrimary: true, roles: [], contact: { firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: 'Dana', lastNameEn: 'Levi' } }];
  assert.equal(blockByKey(compose({ deal: baseDeal({ contacts }), lang: 'en' }), 'hero').data.customerName, 'Dana Levi');
  assert.equal(blockByKey(compose({ deal: baseDeal({ contacts }), lang: 'he' }), 'hero').data.customerName, 'דנה לוי');
});

// ── program section ("אז מה בתוכנית?") ────────────────────────────────────────
// TITLE from the Quote Template (default when no template passed); CONTENT from
// the selected Product Variant; language-aware; empty content → null (renderer skips).
test('composer: program block uses variant copy + the section title, language-aware', () => {
  const v = { marketingDescHe: '', marketingDescEn: '', durationHours: 2, programHe: '<p>תוכנית</p>', programEn: '<p>program</p>' };
  const he = blockByKey(compose({ deal: baseDeal({ productVariant: v }), lang: 'he' }), 'program').data;
  const en = blockByKey(compose({ deal: baseDeal({ productVariant: v }), lang: 'en' }), 'program').data;
  assert.equal(he.title, 'אז מה בתוכנית?');
  assert.equal(he.html, '<p>תוכנית</p>');
  assert.equal(en.title, "What's in the program?");
  assert.equal(en.html, '<p>program</p>');
});

test('composer: empty variant program → null html (renderer skips) + a warning', () => {
  const v = { marketingDescHe: '', marketingDescEn: '', durationHours: 2, programHe: '', programEn: '' };
  const model = compose({ deal: baseDeal({ productVariant: v }), lang: 'he' });
  assert.equal(blockByKey(model, 'program').data.html, null);
  assert.ok(model.warnings.some((w) => w.blockKey === 'program'), 'variant present but no copy → warns');
});

test('composer: program appears immediately before Technical Details by default', () => {
  const keys = compose().blocks.map((b) => b.key);
  assert.equal(keys.indexOf('program') + 1, keys.indexOf('tour_details'), 'program directly precedes tour_details');
});

// ── configurable titles + video (no-template path uses built-in defaults) ─────
test('composer: product-details + pricing titles default to the built-in section titles', () => {
  const model = compose();
  assert.equal(blockByKey(model, 'product_marketing').data.title, 'מה כולל הסיור?');
  assert.equal(blockByKey(model, 'pricing').data.title, 'כמה עולה?');
});

test('composer: product-details content still comes from the Product Variant', () => {
  const deal = baseDeal({ productVariant: { marketingDescHe: '<p>וריאציה</p>', marketingDescEn: '', durationHours: 2 } });
  assert.equal(blockByKey(compose({ deal }), 'product_marketing').data.html, '<p>וריאציה</p>');
});

test('composer: video is present in order (after product details) but inert without config', () => {
  const keys = compose().blocks.map((b) => b.key);
  assert.equal(keys.indexOf('video'), keys.indexOf('product_marketing') + 1, 'video directly follows product details');
  assert.ok(keys.indexOf('video') < keys.indexOf('pricing'), 'video is before pricing');
  assert.equal(blockByKey(compose(), 'video').data.url, null, 'no template video config → inert');
});

test('composer: video editTarget routes to the Quote Structure video tab', () => {
  const et = blockByKey(compose(), 'video').editTarget;
  assert.equal(et.kind, 'quoteStructure');
  assert.equal(et.tab, 'video');
});

// ── reconciliation: newly-added blocks appear in old per-quote compositions ────
test('composer: an old compositionDraft gains program (before Tech Details) + video (after Product Details)', () => {
  // A draft saved before program/video existed — the canonical order minus them.
  const oldOrder = ['hero','tour_details','product_marketing','why_grafitiyul','classification','pricing','payment_terms','faq','cancellation','participant_policy','signature'];
  const document = doc({ compositionDraft: { blocks: oldOrder.map((key) => ({ key })) } });
  const keys = compose({ document }).blocks.map((b) => b.key);
  assert.ok(keys.includes('program') && keys.includes('video'), 'both reconciled in');
  assert.equal(keys.indexOf('program') + 1, keys.indexOf('tour_details'), 'program directly before Technical Details');
  assert.equal(keys.indexOf('video'), keys.indexOf('product_marketing') + 1, 'video directly after Product Details');
});
