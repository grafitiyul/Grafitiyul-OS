import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationContextFor } from './tourContext.js';

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
