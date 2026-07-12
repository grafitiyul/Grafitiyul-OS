import test from 'node:test';
import assert from 'node:assert/strict';
import './dealTourSync.js'; // side-effect: registers the issue type + detector
import { issueTypeDef } from '../registry.js';

const DEF = issueTypeDef('deal_tour_out_of_sync');

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
