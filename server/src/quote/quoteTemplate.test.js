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

test('normalizeLayout: keeps saved order, drops unknowns, appends missing canonical keys', () => {
  const l = normalizeLayout({ sections: [{ key: 'pricing', hidden: true }, { key: 'bogus' }, { key: 'hero' }] });
  // hero is pinned first (header); other saved keys keep their order; unknown
  // dropped; missing canonical keys appended.
  assert.equal(l.sections[0].key, 'hero');
  assert.equal(l.sections[1].key, 'pricing');
  assert.equal(l.sections[1].hidden, true);
  assert.equal(l.sections.length, SECTION_KEYS.length);
  assert.ok(!l.sections.some((s) => s.key === 'bogus'));
  // every canonical key present exactly once
  assert.deepEqual([...new Set(l.sections.map((s) => s.key))].sort(), [...SECTION_KEYS].sort());
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
  productVariant: { durationHours: 2 },
  location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
  organization: { name: 'ארגון' },
  tourDate: '2026-07-10',
  tourTime: '10:00',
  participants: 20,
  tourLanguage: 'he',
  contacts: [],
});
const doc = (over = {}) => ({ id: 'qd', dealId: 'd', quoteVersionId: 'v', language: 'he', displayProductName: null, personalIntro: null, compositionDraft: null, ...over });
const compose = (template, over = {}) =>
  assembleComposition({ document: over.document || doc(), deal: deal(), version: { id: 'v' }, lines: [], quoteSections: [], lang: 'he', template });

test('composer: template.sections drive order when the quote has no compositionDraft', () => {
  // pricing before personal_intro (both non-hero) shows the template order is honoured.
  const template = normalizeLayout({ sections: [{ key: 'pricing' }, { key: 'personal_intro' }] });
  const keys = compose(template).blocks.map((b) => b.key);
  assert.equal(keys[0], 'hero'); // header is always first
  assert.ok(keys.indexOf('pricing') < keys.indexOf('personal_intro'));
});

test('composer: per-quote compositionDraft overrides the template (seed-only rule)', () => {
  const template = normalizeLayout({ sections: [{ key: 'pricing' }, { key: 'personal_intro' }] });
  const model = compose(template, { document: doc({ compositionDraft: { blocks: [{ key: 'personal_intro' }, { key: 'pricing' }] } }) });
  const keys = model.blocks.map((b) => b.key);
  assert.ok(keys.indexOf('personal_intro') < keys.indexOf('pricing'), 'per-doc order wins');
});

test('composer: hero is forced first and never hidden, even if a stored order moves/hides it', () => {
  const model = compose(undefined, { document: doc({ compositionDraft: { blocks: [{ key: 'pricing' }, { key: 'hero', hidden: true }] } }) });
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
