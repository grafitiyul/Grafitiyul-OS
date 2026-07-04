// Quote Layout Template tests. Two halves, both pure (no DB):
//  1. normalizeLayout — the safety net that keeps the stored layout complete and
//     free of unknown keys as blocks/fields evolve.
//  2. assembleComposition WITH a template — the compose-time precedence and the
//     hero/technical injection. The no-template path is covered in composer.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout, DEFAULT_LAYOUT, TECH_FIELD_KEYS } from './quoteTemplate.js';
import { assembleComposition, DEFAULT_QUOTE_BLOCKS } from './composer.js';

const SECTION_KEYS = DEFAULT_QUOTE_BLOCKS.map((b) => b.key);

// ── normalizeLayout ──────────────────────────────────────────────────────────

test('normalizeLayout: null → complete default (all sections + fields present)', () => {
  const l = normalizeLayout(null);
  assert.deepEqual(l.sections.map((s) => s.key), SECTION_KEYS);
  assert.ok(l.sections.every((s) => s.hidden === false));
  assert.deepEqual(l.technical.fields.map((f) => f.key), TECH_FIELD_KEYS);
  assert.ok(l.technical.fields.every((f) => f.visible === true));
  assert.equal(l.hero.overlay, 'dark');
  assert.equal(l.hero.image, null);
});

test('normalizeLayout: DEFAULT_LAYOUT is already normalised (idempotent)', () => {
  assert.deepEqual(normalizeLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT);
});

test('normalizeLayout: LEGACY layout (no version) is migrated to canonical order, hidden preserved, unknowns dropped', () => {
  // No `v` → the saved order is untrusted (old code appended new blocks at the end);
  // it is re-canonicalised. Hidden flags are preserved by KEY; unknowns are dropped.
  const l = normalizeLayout({ sections: [{ key: 'pricing', hidden: true }, { key: 'bogus' }, { key: 'hero' }] });
  assert.equal(l.v, 2, 'version is stamped after migration');
  assert.deepEqual(l.sections.map((s) => s.key), SECTION_KEYS, 'canonical order');
  assert.equal(l.sections.find((s) => s.key === 'pricing').hidden, true, 'hidden preserved by key');
  assert.equal(l.sections.length, SECTION_KEYS.length);
  assert.ok(!l.sections.some((s) => s.key === 'bogus'), 'unknown dropped');
});

test('normalizeLayout: VERSIONED layout preserves a deliberate reorder + inserts new blocks canonically', () => {
  // A versioned layout keeps its drag-reorder verbatim (faq moved before pricing)…
  const reordered = ['hero', 'program', 'tour_details', 'product_marketing', 'why_grafitiyul', 'classification', 'faq', 'pricing', 'cancellation', 'participant_policy', 'signature'];
  const l = normalizeLayout({ v: 2, sections: reordered.map((key) => ({ key })) });
  assert.ok(l.sections.findIndex((s) => s.key === 'faq') < l.sections.findIndex((s) => s.key === 'pricing'), 'reorder preserved');
  // …and a canonical block missing from the saved order (video) is inserted at its
  // canonical position (right after product_marketing), never appended at the end.
  assert.equal(l.sections.findIndex((s) => s.key === 'video'), l.sections.findIndex((s) => s.key === 'product_marketing') + 1);
});

test('normalizeLayout: hero is pinned first and never hidden', () => {
  const l = normalizeLayout({ sections: [{ key: 'pricing' }, { key: 'hero', hidden: true }] });
  assert.equal(l.sections[0].key, 'hero');
  assert.equal(l.sections[0].hidden, false);
});

test('normalizeLayout: collapses duplicate keys to the first occurrence', () => {
  const l = normalizeLayout({ sections: [{ key: 'pricing', hidden: true }, { key: 'pricing', hidden: false }] });
  assert.equal(l.sections.filter((s) => s.key === 'pricing').length, 1);
  assert.equal(l.sections.find((s) => s.key === 'pricing').hidden, true); // first occurrence wins
});

test('normalizeLayout: invalid overlay falls back to dark; valid kept', () => {
  assert.equal(normalizeLayout({ hero: { overlay: 'neon' } }).hero.overlay, 'dark');
  assert.equal(normalizeLayout({ hero: { overlay: 'light' } }).hero.overlay, 'light');
});

test('normalizeLayout: hero image requires a url; text is trimmed', () => {
  assert.equal(normalizeLayout({ hero: { image: { id: 'm1' } } }).hero.image, null);
  assert.deepEqual(normalizeLayout({ hero: { image: { id: 'm1', url: 'u' } } }).hero.image, { id: 'm1', url: 'u' });
  assert.equal(normalizeLayout({ hero: { titleHe: '  שלום  ' } }).hero.titleHe, 'שלום');
  assert.equal(normalizeLayout({ hero: { titleHe: '   ' } }).hero.titleHe, null);
});

test('normalizeLayout: new premium-cover hero defaults are present', () => {
  const h = normalizeLayout(null).hero;
  assert.equal(h.logoSizePx, 56);
  assert.equal(h.logoMargin, 24);
  assert.equal(h.contentV, 'center');
  assert.equal(h.cardEnabled, true);
  assert.equal(h.cardOpacity, 70);
  assert.equal(h.cardBlur, 'md');
  assert.equal(h.cardColor, '#081220');
  assert.deepEqual(h.cardFields, { preparedFor: true, org: true, generatedOn: true, preparedBy: true });
});

test('normalizeLayout: logo px + margin are clamped; invalid enums fall back', () => {
  const h = normalizeLayout({ hero: { logoSizePx: 9999, logoMargin: -5, contentV: 'sideways', cardBlur: 'blurry' } }).hero;
  assert.equal(h.logoSizePx, 220); // clamped to max
  assert.equal(h.logoMargin, 0); // clamped to min
  assert.equal(h.contentV, 'center'); // invalid → default
  assert.equal(h.cardBlur, 'md'); // invalid → default
});

test('normalizeLayout: cardFields — missing keys default visible, explicit false respected', () => {
  const h = normalizeLayout({ hero: { cardEnabled: false, cardFields: { org: false } } }).hero;
  assert.equal(h.cardEnabled, false);
  assert.deepEqual(h.cardFields, { preparedFor: true, org: false, generatedOn: true, preparedBy: true });
});

// ── assembleComposition with a template ──────────────────────────────────────

const deal = () => ({
  id: 'd',
  product: { nameHe: 'סיור', nameEn: 'Tour' },
  productVariantId: 'v1',
  productVariant: { id: 'v1', durationHours: 2 },
  location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
  organization: { name: 'ארגון' },
  tourDate: '2026-07-10',
  tourTime: '10:00',
  participants: 20,
  tourLanguage: 'he',
  contacts: [],
});
const doc = (over = {}) => ({ id: 'qd', dealId: 'd', quoteVersionId: 'v', language: 'he', displayProductName: null, compositionDraft: null, ...over });
const compose = (template, over = {}) =>
  assembleComposition({ document: over.document || doc(), deal: deal(), version: { id: 'v' }, lines: [], quoteSections: [], lang: 'he', template });

test('composer: template.sections drive order when the quote has no compositionDraft', () => {
  // pricing before faq (both non-hero) shows the template order is honoured.
  const template = normalizeLayout({ sections: [{ key: 'pricing' }, { key: 'faq' }] });
  const keys = compose(template).blocks.map((b) => b.key);
  assert.equal(keys[0], 'hero'); // header is always first
  assert.ok(keys.indexOf('pricing') < keys.indexOf('faq'));
});

test('composer: the template is the SINGLE source — a per-quote compositionDraft is ignored', () => {
  // Template says pricing→faq; the (legacy) per-quote draft says faq→pricing. The
  // draft must NOT win: the quote follows Quote Structure (the template) only.
  const template = normalizeLayout({ v: 2, sections: [{ key: 'pricing' }, { key: 'faq' }] });
  const withDraft = compose(template, { document: doc({ compositionDraft: { blocks: [{ key: 'faq' }, { key: 'pricing' }] } }) }).blocks.map((b) => b.key);
  const withoutDraft = compose(template).blocks.map((b) => b.key);
  assert.deepEqual(withDraft, withoutDraft, 'draft has no effect');
  assert.ok(withDraft.indexOf('pricing') < withDraft.indexOf('faq'), 'template order wins');
});

test('composer: hero is forced first and never hidden, regardless of any stored order', () => {
  const template = normalizeLayout({ v: 2, sections: [{ key: 'pricing' }, { key: 'hero', hidden: true }] });
  const model = compose(template);
  assert.equal(model.blocks[0].key, 'hero');
  assert.equal(model.blocks[0].hidden, false);
});

test('composer: template hides an optional section by default', () => {
  const template = normalizeLayout({ sections: [{ key: 'faq', hidden: true }] });
  const model = compose(template);
  assert.equal(model.blocks.find((b) => b.key === 'faq').hidden, true);
});

test('composer: hero uses template title/overlay and the configured image', () => {
  const template = normalizeLayout({ hero: { titleHe: 'הצעה מיוחדת', overlay: 'light', image: { id: 'm', url: 'https://cdn/hero.jpg' } } });
  const hero = compose(template).blocks.find((b) => b.key === 'hero').data;
  assert.equal(hero.heroTitle, 'הצעה מיוחדת');
  assert.equal(hero.heroOverlay, 'light');
  assert.equal(hero.heroImageUrl, 'https://cdn/hero.jpg');
});

// Hero image priority — the shared rule that keeps preview == produced output.
const dealWithImage = () => ({
  ...deal(),
  productVariant: { durationHours: 2, galleryImages: [{ mediaFile: { url: 'https://cdn/deal.jpg' } }] },
});
const composeHero = (template, dealObj) =>
  assembleComposition({ document: doc(), deal: dealObj, version: { id: 'v' }, lines: [], quoteSections: [], lang: 'he', template })
    .blocks.find((b) => b.key === 'hero').data;

test('composer: configured Hero image (Quote Structure) wins over the deal/product image', () => {
  const template = normalizeLayout({ hero: { image: { id: 'm', url: 'https://cdn/hero.jpg' } } });
  assert.equal(composeHero(template, dealWithImage()).heroImageUrl, 'https://cdn/hero.jpg');
});

test('composer: with no configured Hero image, the deal/product image is the fallback', () => {
  const template = normalizeLayout({ hero: {} }); // no image configured
  assert.equal(composeHero(template, dealWithImage()).heroImageUrl, 'https://cdn/deal.jpg');
});

test('composer: technical fieldOrder reflects visible fields in configured order', () => {
  const template = normalizeLayout({
    technical: { fields: [{ key: 'participants', visible: true }, { key: 'city', visible: true }, { key: 'date', visible: false }] },
  });
  const td = compose(template).blocks.find((b) => b.key === 'tour_details').data;
  // 'date' hidden → excluded; visible ones keep configured order; the rest (time,
  // duration, language) appended by normalizeLayout stay visible after them.
  assert.deepEqual(td.fieldOrder.slice(0, 2), ['participants', 'city']);
  assert.ok(!td.fieldOrder.includes('date'));
});

// ── configurable section titles (source of truth) ────────────────────────────
test('normalizeLayout: sectionTitles default, trim, and never go blank', () => {
  const st = normalizeLayout(null).sectionTitles;
  assert.deepEqual(st.program, { titleHe: 'אז מה בתוכנית?', titleEn: "What's in the program?" });
  assert.deepEqual(st.product_marketing, { titleHe: 'מה כולל הסיור?', titleEn: "What's Included?" });
  assert.deepEqual(st.pricing, { titleHe: 'כמה עולה?', titleEn: 'Pricing' });
  assert.equal(normalizeLayout({ sectionTitles: { program: { titleHe: '  שלב הסיור  ' } } }).sectionTitles.program.titleHe, 'שלב הסיור');
  assert.equal(normalizeLayout({ sectionTitles: { pricing: { titleHe: '   ' } } }).sectionTitles.pricing.titleHe, 'כמה עולה?', 'blank → default');
});

test('normalizeLayout: legacy `program` title is migrated into sectionTitles.program', () => {
  const st = normalizeLayout({ program: { titleHe: 'ישן', titleEn: 'Old' } }).sectionTitles;
  assert.equal(st.program.titleHe, 'ישן');
  assert.equal(st.program.titleEn, 'Old');
});

test('composer: program/product-details/pricing titles come from the template', () => {
  const template = normalizeLayout({ sectionTitles: {
    program: { titleHe: 'מה חווים?' },
    product_marketing: { titleHe: 'על הסיור' },
    pricing: { titleHe: 'כמה זה עולה?' },
  } });
  const blocks = compose(template).blocks;
  assert.equal(blocks.find((b) => b.key === 'program').data.title, 'מה חווים?');
  assert.equal(blocks.find((b) => b.key === 'product_marketing').data.title, 'על הסיור');
  assert.equal(blocks.find((b) => b.key === 'pricing').data.title, 'כמה זה עולה?');
});

// ── Video Library (variant-gated; one variant → one video) ───────────────────
const videoBlock = (template) => compose(template).blocks.find((b) => b.key === 'video').data;
const A = 'https://youtu.be/aaaaaaaaaaa';
const B = 'https://youtu.be/bbbbbbbbbbb';

test('composer: renders the library video whose variant matches the deal (v1)', () => {
  const t = normalizeLayout({ videos: [
    { id: '1', url: A, variantIds: ['other'] },
    { id: '2', url: B, variantIds: ['v1'], titleHe: 'צפו בסיור' }, // deal.productVariantId === 'v1'
  ] });
  const d = videoBlock(t);
  assert.equal(d.url, B, 'the video assigned to v1 wins');
  assert.equal(d.title, 'צפו בסיור');
});

test('composer: no video matches the deal variant → section skipped', () => {
  const t = normalizeLayout({ videos: [{ id: '1', url: A, variantIds: ['other'] }] });
  assert.equal(videoBlock(t).url, null);
});

test('composer: a video with no URL never renders even if the variant matches', () => {
  const t = normalizeLayout({ videos: [{ id: '1', url: '', variantIds: ['v1'] }] });
  assert.equal(videoBlock(t).url, null);
});

test('composer: video title defaults to "סרטון"/"Video" when none is set', () => {
  const t = normalizeLayout({ videos: [{ id: '1', url: A, variantIds: ['v1'] }] });
  assert.equal(videoBlock(t).title, 'סרטון');
});

test('normalizeVideos: a variant belongs to ONE video (first occurrence wins)', () => {
  const { videos } = normalizeLayout({ videos: [
    { id: '1', url: A, variantIds: ['v1', 'v2'] },
    { id: '2', url: B, variantIds: ['v2', 'v3'] }, // v2 already claimed by video 1
  ] });
  assert.deepEqual(videos[0].variantIds, ['v1', 'v2']);
  assert.deepEqual(videos[1].variantIds, ['v3'], 'v2 dropped from the second video');
});

test('normalizeVideos: every video gets a stable id; empty default', () => {
  assert.deepEqual(normalizeLayout(null).videos, []);
  const { videos } = normalizeLayout({ videos: [{ url: A, variantIds: [] }] });
  assert.equal(videos.length, 1);
  assert.ok(typeof videos[0].id === 'string' && videos[0].id.length > 0, 'id backfilled');
});

test('normalizeVideos: legacy single `video` object migrates into a one-item library', () => {
  const { videos } = normalizeLayout({ video: { url: A, variantIds: ['v1'], titleHe: 'ישן' } });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].url, A);
  assert.deepEqual(videos[0].variantIds, ['v1']);
  assert.equal(videos[0].titleHe, 'ישן');
});

// ── reconciliation: template section list slots new blocks into canonical spots ─
test('normalizeLayout: an old sections list gains program/video at their canonical positions', () => {
  const oldOrder = ['hero','tour_details','product_marketing','why_grafitiyul','classification','pricing','payment_terms','faq','cancellation','participant_policy','signature'];
  const keys = normalizeLayout({ sections: oldOrder.map((key) => ({ key })) }).sections.map((s) => s.key);
  assert.ok(!keys.includes('payment_terms'), 'stale/removed block (payment_terms) is dropped');
  assert.ok(!keys.includes('classification'), 'stale/removed block (classification) is dropped');
  assert.equal(keys.indexOf('program') + 1, keys.indexOf('tour_details'), 'program before Technical Details');
  assert.equal(keys.indexOf('video'), keys.indexOf('product_marketing') + 1, 'video after Product Details');
});

// ── Sections as the single control: hidden + drag order flow to the quote ─────
test('composer: a hidden section in the template is marked hidden (and pricing is hideable)', () => {
  assert.equal(compose(normalizeLayout({ v: 2, sections: [{ key: 'faq', hidden: true }] })).blocks.find((b) => b.key === 'faq').hidden, true);
  assert.equal(compose(normalizeLayout({ v: 2, sections: [{ key: 'pricing', hidden: true }] })).blocks.find((b) => b.key === 'pricing').hidden, true, 'pricing can be hidden');
});

test('composer: the template drag order is followed by the quote', () => {
  const template = normalizeLayout({ v: 2, sections: [{ key: 'faq' }, { key: 'pricing' }] }); // faq dragged before pricing
  const keys = compose(template).blocks.map((b) => b.key);
  assert.ok(keys.indexOf('faq') < keys.indexOf('pricing'), 'quote follows the template order');
});

// ── section titles: a rename in Quote Structure flows to the quote (all sections) ─
test('composer: renamed section titles flow to the quote (why_grafitiyul, faq, signature)', () => {
  const template = normalizeLayout({ v: 2, sectionTitles: {
    why_grafitiyul: { titleHe: 'למה אנחנו?' }, faq: { titleHe: 'שו״ת' }, signature: { titleHe: 'אישור' },
  } });
  const title = (k) => compose(template).blocks.find((b) => b.key === k).data.title;
  assert.equal(title('why_grafitiyul'), 'למה אנחנו?');
  assert.equal(title('faq'), 'שו״ת');
  assert.equal(title('signature'), 'אישור');
});

// ── Quote Image Library (per-slot one-variant-one-image) ─────────────────────
test('normalizeImages: a variant belongs to ONE image PER SLOT; allowed across slots', () => {
  const url = 'https://cdn/a.jpg';
  const { images } = normalizeLayout({ images: [
    { id: 'a', slot: 'slot1', image: { url }, variantIds: ['v1', 'v2'] },
    { id: 'b', slot: 'slot1', image: { url }, variantIds: ['v2', 'v3'] }, // v2 already claimed in slot1
    { id: 'c', slot: 'slot2', image: { url }, variantIds: ['v1'] },       // v1 in the OTHER slot is allowed
  ] });
  assert.deepEqual(images[0].variantIds, ['v1', 'v2']);
  assert.deepEqual(images[1].variantIds, ['v3'], 'v2 dropped within slot1');
  assert.deepEqual(images[2].variantIds, ['v1'], 'v1 allowed in slot2');
});

test('normalizeImages: stable id, valid slot, url required, empty default', () => {
  assert.deepEqual(normalizeLayout(null).images, []);
  const { images } = normalizeLayout({ images: [{ slot: 'bogus', image: { id: 'm' }, variantIds: [] }] });
  assert.equal(images.length, 1);
  assert.ok(typeof images[0].id === 'string' && images[0].id.length > 0);
  assert.equal(images[0].slot, 'slot1', 'invalid slot → slot1');
  assert.equal(images[0].image, null, 'image needs a url');
});

test('composer: image slot renders the matching image for the deal variant, skips otherwise', () => {
  const url = 'https://cdn/pic.jpg';
  const t = normalizeLayout({ images: [
    { id: '1', slot: 'slot1', image: { url }, variantIds: ['v1'], captionHe: 'כיתוב' },
    { id: '2', slot: 'slot2', image: { url }, variantIds: ['other'] },
  ] }); // deal().productVariantId === 'v1'
  const s1 = compose(t).blocks.find((b) => b.key === 'image_slot_1').data;
  const s2 = compose(t).blocks.find((b) => b.key === 'image_slot_2').data;
  assert.equal(s1.imageUrl, url);
  assert.equal(s1.caption, 'כיתוב');
  assert.equal(s2.imageUrl, null, 'no slot2 image targets v1 → skipped');
});

// ── Business contact (public-page "צור קשר") ─────────────────────────────────
test('normalizeLayout: contact defaults to empty strings', () => {
  assert.deepEqual(normalizeLayout(null).contact, { whatsapp: '', email: '' });
});

test('normalizeLayout: whatsapp is reduced to digits; too-short → empty', () => {
  assert.equal(normalizeLayout({ contact: { whatsapp: '+972 50-123-4567' } }).contact.whatsapp, '972501234567');
  assert.equal(normalizeLayout({ contact: { whatsapp: '12345' } }).contact.whatsapp, '', 'under 6 digits → empty');
  assert.equal(normalizeLayout({ contact: { whatsapp: 'abc' } }).contact.whatsapp, '');
});

test('normalizeLayout: contact email is trimmed; non-string → empty', () => {
  assert.equal(normalizeLayout({ contact: { email: '  hi@x.co  ' } }).contact.email, 'hi@x.co');
  assert.equal(normalizeLayout({ contact: { email: 123 } }).contact.email, '');
});
