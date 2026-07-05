// Quote Module — Slice 2 Composer tests. Pure: no DB. `assembleComposition` is
// exercised directly on plain fixtures; the client-injected loader is exercised
// against a tiny fake client. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleComposition, composeQuoteDraftPreview, DEFAULT_QUOTE_BLOCKS, pickLang, toPublicModel, toPublicSignature, isLockedStatus } from './composer.js';
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

// ── single source of truth: a per-quote compositionDraft NO LONGER controls order/
// visibility. Quote Structure (the template) is the only source. ──────────────
test('composer: a per-quote compositionDraft is ignored — order/visibility come from the template', () => {
  const withDraft = doc({ language: 'en', compositionDraft: { blocks: [{ key: 'pricing' }, { key: 'cancellation', hidden: true }, { key: 'hero' }] } });
  const withoutDraft = doc({ language: 'en' });
  const a = compose({ document: withDraft, lang: 'en' }).blocks.map((b) => `${b.key}${b.hidden ? '*' : ''}`);
  const b = compose({ document: withoutDraft, lang: 'en' }).blocks.map((b) => `${b.key}${b.hidden ? '*' : ''}`);
  assert.deepEqual(a, b, 'the draft has no effect on order or visibility');
  assert.equal(a[0], 'hero');
  assert.ok(!a.includes('cancellation*'), 'the draft cannot hide a block');
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
  const document = doc({ overrideState: { blocks: { why_grafitiyul: { html: '<p>נוסח מותאם</p>' } } } });
  const model = compose({ document });
  const b = blockByKey(model, 'why_grafitiyul');
  assert.equal(b.data.html, '<p>נוסח מותאם</p>');
  assert.equal(b.overridden, true);
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
  // "Why Grafitiyul" now edits at the Organization Type (its content source).
  assert.equal(blockByKey(model, 'why_grafitiyul').editTarget.kind, 'orgType');
  assert.equal(blockByKey(model, 'why_grafitiyul').editTarget.id, 'ot1');
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

// ── canonical default order (no template) puts program/video in place ─────────
test('composer: default order has program before Tech Details + video after Product Details', () => {
  const keys = compose().blocks.map((b) => b.key);
  assert.ok(keys.includes('program') && keys.includes('video'));
  assert.equal(keys.indexOf('program') + 1, keys.indexOf('tour_details'), 'program directly before Technical Details');
  assert.equal(keys.indexOf('video'), keys.indexOf('product_marketing') + 1, 'video directly after Product Details');
  assert.ok(!keys.includes('payment_terms'), 'payment_terms is no longer a standalone section');
});

// ── tour details: city falls back to the variant's location ──────────────────
test('composer: city tile resolves from the variant location when the deal has none', () => {
  const deal = baseDeal({ location: null, productVariant: { durationHours: 2, location: { nameHe: 'ירושלים', nameEn: 'Jerusalem' } } });
  const td = blockByKey(compose({ deal }), 'tour_details').data;
  assert.equal(td.city, 'ירושלים', 'city comes from the variant location fallback');
});

test('composer: deal location still wins for the city tile when present', () => {
  const deal = baseDeal({ location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' }, productVariant: { durationHours: 2, location: { nameHe: 'ירושלים' } } });
  assert.equal(blockByKey(compose({ deal }), 'tour_details').data.city, 'תל אביב');
});

// ── pricing carries payment term/method for the merged pricing section ────────
test('composer: pricing block includes the selected payment term + method', () => {
  const p = blockByKey(compose(), 'pricing').data;
  assert.equal(p.paymentTerm, 'שוטף+30');
  assert.equal(p.paymentMethod, 'העברה');
  // English uses the En names.
  const pen = blockByKey(compose({ lang: 'en', document: { id:'qd_1', dealId:'deal_1', quoteVersionId:'ver_1', language:'en', displayProductName:null, compositionDraft:null } }), 'pricing').data;
  assert.equal(pen.paymentTerm, 'Net 30');
  assert.equal(pen.paymentMethod, 'Transfer');
});

test('composer: pricing payment fields are null when the deal has no term/method', () => {
  const deal = baseDeal({ paymentTerm: null, paymentMethodRef: null });
  const p = blockByKey(compose({ deal }), 'pricing').data;
  assert.equal(p.paymentTerm, null);
  assert.equal(p.paymentMethod, null);
});

// ── Technical Details: duration (deal→variant fallback) ───────────────────────
test('composer: duration resolves from the variant; deal override wins; absent when neither has it', () => {
  assert.equal(blockByKey(compose(), 'tour_details').data.durationHours, 2.5, 'from the variant');
  const noDur = baseDeal({ productVariant: { marketingDescHe: '', marketingDescEn: '', durationHours: null } });
  assert.equal(blockByKey(compose({ deal: noDur }), 'tour_details').data.durationHours, null, 'legitimately absent');
  const dealDur = baseDeal({ durationHours: 3 });
  assert.equal(blockByKey(compose({ deal: dealDur }), 'tour_details').data.durationHours, 3, 'deal override wins');
});

// ── Why Grafitiyul: content from Org Subtype → Org Type; single source of truth ─
test('composer: Why Grafitiyul — subtype overrides type; type fallback; empty skips', () => {
  const both = baseDeal({ organization: {}, organizationSubtype: { quoteContentHe: '<p>תת-סוג</p>' }, organizationType: { quoteContentHe: '<p>סוג</p>' } });
  assert.equal(blockByKey(compose({ deal: both }), 'why_grafitiyul').data.html, '<p>תת-סוג</p>', 'subtype overrides type');
  const typeOnly = baseDeal({ organization: {}, organizationSubtype: null, organizationType: { quoteContentHe: '<p>סוג</p>' } });
  assert.equal(blockByKey(compose({ deal: typeOnly }), 'why_grafitiyul').data.html, '<p>סוג</p>', 'type fallback');
  const neither = baseDeal({ organization: {}, organizationSubtype: null, organizationType: null });
  assert.equal(blockByKey(compose({ deal: neither }), 'why_grafitiyul').data.html, null, 'empty → skip');
});

test('composer: the duplicate "classification" section is gone', () => {
  assert.ok(!compose().blocks.some((b) => b.key === 'classification' || b.type === 'classification'), 'no classification block');
});

test('composer: every heading section gets a default title (no template → built-in defaults)', () => {
  const b = (k) => blockByKey(compose(), k).data.title;
  assert.equal(b('tour_details'), 'פרטים טכניים');
  assert.equal(b('why_grafitiyul'), 'למה גרפיטיול?');
  assert.equal(b('faq'), 'שאלות נפוצות');
  assert.equal(b('cancellation'), 'מדיניות ביטול / דחייה');
  assert.equal(b('participant_policy'), 'מדיניות שינוי כמות המשתתפים');
  assert.equal(b('signature'), 'חתימה');
});

// ── "Edit at source" targets the ACTIVE Why-Grafitiyul source ─────────────────
test('composer: Why-Grafitiyul edit target follows the active source (subtype vs type)', () => {
  const subActive = baseDeal({ organization: {}, organizationSubtypeId: 'sub1', organizationSubtype: { quoteContentHe: '<p>x</p>' }, organizationTypeId: 'ot1', organizationType: { quoteContentHe: '<p>y</p>' } });
  const et1 = blockByKey(compose({ deal: subActive }), 'why_grafitiyul').editTarget;
  assert.equal(et1.kind, 'orgSubtype', 'subtype provides content → edit subtype');
  assert.equal(et1.id, 'sub1');
  const typeActive = baseDeal({ organization: {}, organizationSubtypeId: 'sub1', organizationSubtype: { quoteContentHe: '' }, organizationTypeId: 'ot1', organizationType: { quoteContentHe: '<p>y</p>' } });
  const et2 = blockByKey(compose({ deal: typeActive }), 'why_grafitiyul').editTarget;
  assert.equal(et2.kind, 'orgType', 'subtype empty → edit type');
  assert.equal(et2.id, 'ot1');
});

// ── FAQ / policies render from their CATEGORISED content; unassigned appears nowhere ─
test('composer: FAQ / Cancellation / Participant-policy render categorised content', () => {
  const m = compose();
  assert.ok(blockByKey(m, 'faq').data.items.length >= 1, 'faq items present');
  assert.ok(blockByKey(m, 'cancellation').data.items.length >= 1, 'cancellation items present');
  assert.ok(blockByKey(m, 'participant_policy').data.items.length >= 1, 'participant_policy items present');
  const uncategorised = compose({ quoteSections: [{ id: 'x', category: null, active: true, titleHe: 'x', richTextHe: '<p>x</p>' }] });
  assert.equal(blockByKey(uncategorised, 'faq').data.items.length, 0, 'unassigned content appears in no section');
});

// ── Public quote helpers (Phase 1/2 signature) ───────────────────────────────
test('toPublicModel: strips admin metadata, keeps render fields', () => {
  const pub = toPublicModel({
    language: 'he',
    warnings: [{ block: 'x' }],
    displayProductNameOverridden: true,
    blocks: [
      { key: 'hero', type: 'hero', kind: 'dynamic', sortOrder: 0, hidden: false, data: { a: 1 }, editTarget: { kind: 'deal' }, source: 'Deal', overridden: true, warnings: ['w'] },
    ],
  });
  assert.deepEqual(Object.keys(pub).sort(), ['blocks', 'language']);
  assert.equal(pub.language, 'he');
  assert.deepEqual(Object.keys(pub.blocks[0]).sort(), ['data', 'hidden', 'key', 'kind', 'sortOrder', 'type']);
  assert.deepEqual(pub.blocks[0].data, { a: 1 }); // block data preserved verbatim
});

test('toPublicSignature: customer-safe shape; null passthrough; never leaks createdBy', () => {
  assert.equal(toPublicSignature(null), null);
  const pub = toPublicSignature({
    id: 's1', quoteDocumentId: 'd1', quoteVersionId: 'v1', createdBy: 'admin-9',
    method: 'typed', signerName: 'דנה', signatureImage: null, signedAt: new Date(0),
    ipAddress: '1.2.3.4', userAgent: 'UA', language: 'he', timezone: 'Asia/Jerusalem',
  });
  assert.ok(!('createdBy' in pub) && !('id' in pub) && !('quoteDocumentId' in pub));
  assert.equal(pub.method, 'typed');
  assert.equal(pub.signerName, 'דנה');
  assert.equal(pub.timezone, 'Asia/Jerusalem');
});

test('isLockedStatus: finalised statuses lock; draft does not', () => {
  for (const s of ['accepted', 'produced', 'rejected', 'expired']) assert.equal(isLockedStatus(s), true, s);
  assert.equal(isLockedStatus('draft'), false);
  assert.equal(isLockedStatus(undefined), false);
});

// ── Deal-level organization type OVERRIDES the linked org's default ──────────
// The quote's org-type-dependent content ("why_us") must follow THIS deal's
// classification, not the linked organization's default type.
test('composer: deal.organizationType overrides the linked org type for why_us', () => {
  const deal = baseDeal({
    organizationSubtype: null,
    organizationType: { quoteContentHe: '<p>מפיקים</p>', quoteContentEn: '<p>producers</p>' }, // deal override
    organization: { name: 'X', organizationType: { quoteContentHe: '<p>בתי ספר</p>', quoteContentEn: '<p>schools</p>' } }, // org default
  });
  const why = blockByKey(compose({ deal }), 'why_grafitiyul').data;
  assert.match(why.html, /מפיקים/, 'uses the deal classification content');
  assert.doesNotMatch(why.html, /בתי ספר/, 'not the linked org default');
});

test('composer: with no deal-level type, why_us falls back to the linked org type', () => {
  const deal = baseDeal({
    organizationSubtype: null,
    organizationType: null, // no override
    organization: { name: 'X', organizationType: { quoteContentHe: '<p>בתי ספר</p>', quoteContentEn: '<p>schools</p>' } },
  });
  const why = blockByKey(compose({ deal }), 'why_grafitiyul').data;
  assert.match(why.html, /בתי ספר/, 'falls back to the org default');
});
