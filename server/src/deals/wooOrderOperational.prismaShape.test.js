// Prisma-shape contract for the Woo operational bridge — the fake-db blind
// spot guard: the in-memory harness stays green with a misspelled field, while
// production 500s on it. Every field/include this module sends to Prisma is
// validated here against the GENERATED DMMF.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const MODELS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const fieldOf = (model, name) => MODELS[model]?.fields.find((f) => f.name === name) || null;
const assertFields = (model, names) => {
  for (const n of names) assert.ok(fieldOf(model, n), `${model}.${n} does not exist`);
};

test('WooVariationLink carries the reverse-resolution fields', () => {
  assertFields('WooVariationLink', ['wooVariationId', 'wooProductId', 'tourEventId', 'cardGroupId', 'ticketTypeId']);
});

test('PriceRule composer query shape matches the schema', () => {
  assertFields('PriceRule', ['cardGroupId', 'availableForGroupTickets', 'active', 'priceModel', 'cardSortOrder', 'vatMode', 'vatRate', 'productId', 'productVariantId', 'firstLineNote', 'multiGroupNote']);
  assert.equal(fieldOf('PriceRule', 'ticketPrices').kind, 'object');
  assert.equal(fieldOf('PriceRule', 'product').kind, 'object');
  assertFields('PriceRuleTicketPrice', ['ticketTypeId', 'priceMinor']);
  assert.equal(fieldOf('PriceRuleTicketPrice', 'ticketType').kind, 'object');
  assertFields('TicketType', ['nameHe', 'sortOrder']);
});

test('PriceList VAT default fields exist', () => {
  assertFields('PriceList', ['isDefault', 'defaultVatMode', 'defaultVatRate']);
});

test('DealCollectionEvidence create data matches the schema', () => {
  assertFields('DealCollectionEvidence', [
    'dealId', 'kind', 'direction', 'amountMinor', 'currency', 'paidAt',
    'method', 'reference', 'note', 'origin', 'createdBy', 'createdByName', 'status',
  ]);
});

test('QuoteLine carries every field the composer persists (lineToData contract)', () => {
  assertFields('QuoteLine', [
    'quoteVersionId', 'kind', 'label', 'productVariantId', 'addonId', 'quantity',
    'unitPriceMinor', 'vatMode', 'vatRate', 'active', 'note', 'overridden',
    'sourceKind', 'sourceCardGroupId', 'ticketTypeId', 'pinnedCardGroupId', 'sortOrder',
  ]);
});

test('ReviewItem attention-card fields exist', () => {
  assertFields('ReviewItem', ['kind', 'dedupeKey', 'title', 'summary', 'data', 'dealId', 'status']);
});

test('IngressEvent order-crosswalk fields exist (mid-flight dealId stamp)', () => {
  assertFields('IngressEvent', ['source', 'sourceKey', 'externalId', 'dealId', 'status', 'receivedAt']);
});
