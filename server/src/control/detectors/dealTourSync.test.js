import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabelMaps } from './dealTourSync.js'; // also registers the issue type + detector
import { issueTypeDef } from '../registry.js';

const DEF = issueTypeDef('deal_tour_out_of_sync');

// A ProductVariant has no name column — it IS a product at a location. Selecting
// a literal `name` was schema drift that made the detector THROW on every sweep
// which found a variant difference, taking the whole issue family down with it.
// This pins the shape of the query, not just its output, because the failure was
// in the query.
test('a product-variant difference is labelled, and the query only asks for columns that exist', async () => {
  const asked = {};
  const client = {
    product: { findMany: async () => [{ id: 'p1', nameHe: 'סיור גרפיטי' }] },
    location: { findMany: async () => [] },
    productVariant: {
      findMany: async (args) => {
        Object.assign(asked, args.select);
        return [{ id: 'v1', product: { nameHe: 'סיור גרפיטי' }, location: { nameHe: 'תל אביב' } }];
      },
    },
  };
  const maps = await buildLabelMaps(client, [{
    diffs: [{ field: 'productVariantId', dealValue: 'v1', tourValue: null }],
  }]);
  assert.equal(maps.variants.get('v1'), 'סיור גרפיטי · תל אביב');
  assert.equal(asked.name, undefined, 'ProductVariant.name does not exist and must never be selected');
  assert.ok(asked.product && asked.location, 'the identity of a variant is its product + location');
});

test('a variant missing its product or location still yields something readable', async () => {
  const client = {
    product: { findMany: async () => [] },
    location: { findMany: async () => [] },
    productVariant: { findMany: async () => [{ id: 'v2', product: null, location: { nameHe: 'חיפה' } }] },
  };
  const maps = await buildLabelMaps(client, [{ diffs: [{ field: 'productVariantId', dealValue: 'v2', tourValue: null }] }]);
  assert.equal(maps.variants.get('v2'), 'חיפה');
});

test('the deal↔tour issue type is registered', () => {
  assert.ok(DEF);
});

test('buildActions offers apply/discard + open deal/tour with resolved targets', () => {
  const actions = DEF.buildActions({ data: { dealId: 'd1', dealOrderNo: 27600, tourEventId: 't1' } });
  assert.deepEqual(actions.map((a) => a.key), ['apply', 'discard', 'open_deal', 'open_tour']);
  assert.equal(actions[0].style, 'primary');
  assert.equal(actions.find((a) => a.key === 'open_deal').target.orderNo, 27600);
  assert.equal(actions.find((a) => a.key === 'open_tour').target.id, 't1');
});

// The detector's diff/display path is exercised through the real
// pendingTourUpdate; here we assert recheck resolves when the drift is gone.
test('recheck resolves when deal and tour agree again', async () => {
  const agreedTour = {
    kind: 'private',
    status: 'scheduled',
    date: '2026-08-01',
    startTime: '10:00',
    tourLanguage: 'he',
    productId: 'p1',
    productVariantId: 'v1',
    locationId: 'l1',
  };
  const deal = {
    tourDate: '2026-08-01',
    tourTime: '10:00',
    tourLanguage: 'he',
    productId: 'p1',
    productVariantId: 'v1',
    locationId: 'l1',
    participants: 4,
  };
  const client = {
    deal: { findUnique: async () => deal },
    booking: {
      findFirst: async () => ({ status: 'active', seats: 4, tourEvent: agreedTour }),
    },
  };
  assert.equal(await DEF.recheck(client, { data: { dealId: 'd1' } }), false);
});

test('recheck keeps the issue while a field still differs', async () => {
  const tour = {
    kind: 'private',
    status: 'scheduled',
    date: '2026-08-01',
    startTime: '10:00',
    tourLanguage: 'he',
    productId: 'p1',
    productVariantId: 'v1',
    locationId: 'l1',
  };
  const deal = {
    tourDate: '2026-08-05', // changed on the deal, tour still 08-01
    tourTime: '10:00',
    tourLanguage: 'he',
    productId: 'p1',
    productVariantId: 'v1',
    locationId: 'l1',
    participants: 4,
  };
  const client = {
    deal: { findUnique: async () => deal },
    booking: {
      findFirst: async () => ({ status: 'active', seats: 4, tourEvent: tour }),
    },
  };
  assert.equal(await DEF.recheck(client, { data: { dealId: 'd1' } }), true);
});

test('recheck resolves when there is no active booking (tour gone)', async () => {
  const client = {
    deal: { findUnique: async () => ({ tourDate: '2026-08-05' }) },
    booking: { findFirst: async () => null },
  };
  assert.equal(await DEF.recheck(client, { data: { dealId: 'd1' } }), false);
});
