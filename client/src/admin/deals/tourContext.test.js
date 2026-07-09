import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationContextFor, priceContextFor } from './tourContext.js';

// The shared product↔variant↔city derivation (used by BOTH the Deal card and
// the parallel-offer dialog). City resolution: matching Product×Location
// variant wins; an unconfigured "other" city keeps the variant empty.

const variants = [
  { id: 'v_tlv', location: { id: 'l_tlv', nameHe: 'תל אביב' } },
  { id: 'v_hfa', locationId: 'l_hfa' }, // legacy shape without the relation
];

test('locationContextFor: configured city resolves its variant (relation shape)', () => {
  assert.deepEqual(locationContextFor(variants, 'l_tlv'), { locationId: 'l_tlv', productVariantId: 'v_tlv' });
});

test('locationContextFor: configured city resolves its variant (locationId shape)', () => {
  assert.deepEqual(locationContextFor(variants, 'l_hfa'), { locationId: 'l_hfa', productVariantId: 'v_hfa' });
});

test('locationContextFor: non-variant "other" city keeps the variant empty', () => {
  assert.deepEqual(locationContextFor(variants, 'l_other'), { locationId: 'l_other', productVariantId: '' });
});

test('locationContextFor: empty selection clears both', () => {
  assert.deepEqual(locationContextFor(variants, ''), { locationId: '', productVariantId: '' });
});

// The pricing-context contract (the ₪95→₪5,900 regression): exact Deal-card
// shape — group→public mapping, participants ''→0, and NO locationId key.
const ATS = [{ id: 'at_pub', key: 'public' }, { id: 'at_biz', key: 'business' }];

test('priceContextFor: business deal resolves its activity type id', () => {
  const ctx = priceContextFor(
    { productId: 'p1', productVariantId: 'v1', participants: 25, activityType: 'business', organizationTypeId: 'ot1', organizationSubtypeId: null },
    ATS,
  );
  assert.deepEqual(ctx, {
    productId: 'p1', productVariantId: 'v1', activityTypeId: 'at_biz',
    organizationTypeId: 'ot1', organizationSubtypeId: null, participantCount: 25,
  });
  assert.ok(!('locationId' in ctx), 'locationId must not leak into the pricing context');
});

test("priceContextFor: 'group' maps to the catalog's public row; empty participants → 0", () => {
  const ctx = priceContextFor({ productId: 'p1', participants: '', activityType: 'group' }, ATS);
  assert.equal(ctx.activityTypeId, 'at_pub');
  assert.equal(ctx.participantCount, 0);
});
