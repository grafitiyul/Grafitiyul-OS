// THE English-strict product label — precedence, and the two things it must
// never do (fall back to Hebrew, or touch Deal.title). Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { PRODUCT_LABEL_EN_INCLUDE, resolveProductLabelEn, productLineEnOrGeneric } from './productLabelEn.js';
import { GENERIC_PRODUCT_LINE_EN } from './displayFallbacks.js';
import { buildTouristDefaults, TOURIST_DEAL_INCLUDE } from './touristPayment.js';

const deal = (over = {}) => ({
  title: 'ליד חדש - דור קורן - סיור גרפיטי', // internal CRM wording: must never surface
  product: { nameHe: 'סיור וסדנת גרפיטי', nameEn: 'Graffiti Tour & Workshop' },
  productVariant: null,
  ...over,
});

test('the variant English commercial name wins — the most specific label', () => {
  const r = resolveProductLabelEn(deal({ productVariant: { agentDisplayNameEn: 'Florentin Graffiti Tour' } }));
  assert.deepEqual(r, { label: 'Florentin Graffiti Tour', source: 'variant' });
});

test('no variant label → the product English name', () => {
  assert.deepEqual(resolveProductLabelEn(deal()), { label: 'Graffiti Tour & Workshop', source: 'product' });
});

test('a variant with only a HEBREW display name falls through to the product, never to Hebrew', () => {
  const r = resolveProductLabelEn(
    deal({ productVariant: { agentDisplayNameEn: null, agentDisplayName: 'סיור פלורנטין' } }),
  );
  assert.deepEqual(r, { label: 'Graffiti Tour & Workshop', source: 'product' });
});

test('no English anywhere → null, NEVER the Hebrew name and NEVER Deal.title', () => {
  const d = deal({ product: { nameHe: 'סיור וסדנת גרפיטי', nameEn: null }, productVariant: { agentDisplayNameEn: null } });
  const r = resolveProductLabelEn(d);
  assert.deepEqual(r, { label: null, source: null });
  // The privacy invariant, restated as a test: the internal title is not a fallback.
  assert.notEqual(r.label, d.title);
});

test('blank/whitespace English values count as missing, not as a label', () => {
  assert.equal(resolveProductLabelEn(deal({ product: { nameEn: '   ' }, productVariant: { agentDisplayNameEn: '' } })).label, null);
});

test('a product-less deal resolves to nothing', () => {
  assert.deepEqual(resolveProductLabelEn({ title: 'ליד חדש' }), { label: null, source: null });
  assert.deepEqual(resolveProductLabelEn(null), { label: null, source: null });
});

test('the must-render variant falls back to approved neutral English, never Hebrew', () => {
  assert.equal(productLineEnOrGeneric(deal()), 'Graffiti Tour & Workshop');
  assert.equal(productLineEnOrGeneric({ product: { nameHe: 'סיור' } }), GENERIC_PRODUCT_LINE_EN);
});

// ── the modal prefill contract ───────────────────────────────────────────────

const fullDeal = (over = {}) => ({
  ...deal(over),
  valueMinor: 100000n,
  currency: 'ILS',
  contacts: [],
  organization: null,
  quoteVersions: [],
});

test('the popup prefills the English description and reports its source', () => {
  const d = fullDeal({ productVariant: { agentDisplayNameEn: 'Florentin Graffiti Tour' } });
  const defaults = buildTouristDefaults(d);
  assert.equal(defaults.productDescriptionEn, 'Florentin Graffiti Tour');
  assert.equal(defaults.productDescriptionEnSource, 'variant');
});

test('a deal with no English content prefills EMPTY with a null source (the modal warns)', () => {
  const defaults = buildTouristDefaults(fullDeal({ product: { nameHe: 'סיור וסדנת גרפיטי', nameEn: null } }));
  assert.equal(defaults.productDescriptionEn, '', 'never the Hebrew name');
  assert.equal(defaults.productDescriptionEnSource, null, 'the modal needs this to explain why it is empty');
});

test('the tourist include really can load what the resolver reads (schema-checked)', () => {
  const MODELS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
  for (const [relation, sel] of Object.entries(PRODUCT_LABEL_EN_INCLUDE)) {
    const field = MODELS.Deal.fields.find((f) => f.name === relation);
    assert.ok(field, `Deal.${relation} does not exist`);
    for (const column of Object.keys(sel.select)) {
      assert.ok(
        MODELS[field.type].fields.some((f) => f.name === column),
        `${field.type}.${column} does not exist — the resolver would silently read undefined`,
      );
    }
  }
  // …and the tourist include actually composes it in.
  assert.ok(TOURIST_DEAL_INCLUDE.productVariant, 'TOURIST_DEAL_INCLUDE must load the variant');
  assert.ok(TOURIST_DEAL_INCLUDE.product.select.nameEn, 'TOURIST_DEAL_INCLUDE must load the English product name');
});
