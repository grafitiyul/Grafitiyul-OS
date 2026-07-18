// Card-authoring invariants (node:test, pure — no DB). These pin the two
// guarantees that make new-card configuration deterministic and keep pricing
// independent of hidden per-row values:
//   1. every rule carries EXPLICIT VAT (create without vatMode is rejected —
//      the PriceList VAT default can never silently apply to a card rule);
//   2. `priority` is not writable — resolution depends only on scope
//      specificity + the ambiguous_price_rule guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildData, PriceRulePayloadError } from './priceRuleData.js';

const CREATE_BODY = {
  productId: 'p1',
  productVariantId: 'v1',
  activityTypeId: 'at1',
  pricingSegmentId: 'seg1',
  cardGroupId: 'card_x',
  priceModel: 'fixed',
  fixedPriceMinor: 118000,
  vatMode: 'included',
  vatRate: 18,
  availableForGroupTickets: false,
  firstLineNote: '<p>הערה</p>',
};

test('create without vatMode is rejected — VAT is always explicit on a card rule', () => {
  const { vatMode, ...noVat } = CREATE_BODY;
  assert.throws(() => buildData(noVat, { partial: false }), (e) => e instanceof PriceRulePayloadError && e.code === 'vat_mode_required');
  assert.throws(() => buildData({ ...CREATE_BODY, vatMode: 'bogus' }, { partial: false }), (e) => e.code === 'vat_mode_required');
});

test('update: absent vatMode leaves VAT untouched; invalid vatMode is rejected', () => {
  const data = buildData({ firstLineNote: '<p>x</p>' }, { partial: true });
  assert.equal('vatMode' in data, false);
  assert.throws(() => buildData({ vatMode: 'bogus' }, { partial: true }), (e) => e.code === 'vat_mode_invalid');
  assert.equal(buildData({ vatMode: 'exempt' }, { partial: true }).vatMode, 'exempt');
});

test('priority is NOT writable — resolution has no hidden per-rule knob', () => {
  const created = buildData({ ...CREATE_BODY, priority: 99 }, { partial: false });
  assert.equal('priority' in created, false);
  const updated = buildData({ priority: 42 }, { partial: true });
  assert.deepEqual(Object.keys(updated), []);
});

test('creating a card rule produces a fully explicit, deterministic payload', () => {
  const a = buildData(CREATE_BODY, { partial: false });
  const b = buildData(CREATE_BODY, { partial: false });
  assert.deepEqual(a, b);
  assert.equal(a.vatMode, 'included');
  assert.equal(a.vatRate, 18);
  assert.equal(a.priceModel, 'fixed');
  assert.equal(a.firstLineNote, '<p>הערה</p>');
  assert.equal(a.cardGroupId, 'card_x');
  // No implicit/hidden fields sneak in.
  assert.equal('priority' in a, false);
});

test('firstLineNote: blank rich markup normalizes to null', () => {
  assert.equal(buildData({ firstLineNote: '<p></p>' }, { partial: true }).firstLineNote, null);
  assert.equal(buildData({ firstLineNote: '' }, { partial: true }).firstLineNote, null);
  assert.equal(buildData({ firstLineNote: '<p>תוכן</p>' }, { partial: true }).firstLineNote, '<p>תוכן</p>');
});

test('defaultOrg association arrays: strings deduped, junk → empty, absent skipped on update', () => {
  const created = buildData({ ...CREATE_BODY, defaultOrgTypeIds: ['a', 'a', '', 'b'], defaultOrgSubtypeIds: 'nope' }, { partial: false });
  assert.deepEqual(created.defaultOrgTypeIds, ['a', 'b']);
  assert.deepEqual(created.defaultOrgSubtypeIds, []);
  const updated = buildData({ firstLineNote: '<p>x</p>' }, { partial: true });
  assert.equal('defaultOrgTypeIds' in updated, false);
});
