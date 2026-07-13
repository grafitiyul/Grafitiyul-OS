import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTourWoo, occurrenceClosed } from './syncWorker.js';
import { META_TOUREVENT_ID, META_CARD_GROUP_ID } from './desiredState.js';

// GOS→Woo reconciler with in-memory fakes for `db` and the `woo` client. Pins
// the required contract: first sync, idempotency (no duplicate variations),
// updates, cancellation (disable not delete), capacity/stock, multiple cards
// sharing ONE canonical capacity, meta-based adoption, and metadata.

function makeEnv(opts = {}) {
  const {
    tour = {
      id: 'slot1',
      status: 'scheduled',
      date: '2026-08-08',
      startTime: '10:00',
      capacity: 20,
      openTourTemplateId: 'tpl1',
      updatedAt: 'u1',
      wooSyncStatus: 'pending',
      wooAttempts: 0,
    },
    templateProducts = [{ cardGroupId: 'cardA' }],
    mappings = [{ cardGroupId: 'cardA', wooProductId: 101, dateAttribute: null, active: true }],
    priceByCard = { cardA: 4500, cardB: 6000 },
    activeSeats = 0,
    links = {},
    variationsByProduct = {},
    registrationCloseMinutes = null,
  } = opts;

  const calls = { created: [], updated: [], deleted: [], tourUpdates: [], linkUpserts: [] };
  const linkStore = { ...links };
  const keyOf = (w) => `${w.tourEventId}::${w.cardGroupId}`;

  const db = {
    tourEvent: {
      findUnique: async ({ where }) => (where.id === tour.id ? { ...tour } : null),
      updateMany: async ({ where, data }) => {
        if (where.updatedAt && where.updatedAt !== tour.updatedAt) return { count: 0 };
        calls.tourUpdates.push(data);
        return { count: 1 };
      },
    },
    openTourTemplate: { findUnique: async () => ({ registrationCloseMinutes }) },
    openTourTemplateProduct: { findMany: async () => templateProducts },
    wooProductMapping: {
      findMany: async ({ where }) =>
        mappings.filter((m) => m.active && where.cardGroupId.in.includes(m.cardGroupId)),
    },
    priceRule: {
      findFirst: async ({ where }) => {
        const price = priceByCard[where.cardGroupId];
        if (price == null) return null;
        return {
          priceModel: 'ticket_types',
          ticketPrices: [{ ticketTypeId: 'tt1', priceMinor: price, ticketType: { nameHe: 'מבוגר', sortOrder: 0 } }],
        };
      },
    },
    ticketRegistration: {
      groupBy: async () => (activeSeats ? [{ tourEventId: tour.id, _sum: { quantity: activeSeats } }] : []),
    },
    booking: { groupBy: async () => [] },
    wooVariationLink: {
      findUnique: async ({ where }) => linkStore[keyOf(where.tourEventId_cardGroupId)] || null,
      upsert: async ({ where, create, update }) => {
        const k = keyOf(where.tourEventId_cardGroupId);
        const row = linkStore[k] ? { ...linkStore[k], ...update } : { ...create };
        linkStore[k] = row;
        calls.linkUpserts.push(row);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
  };

  const woo = {
    listVariations: async (productId) => variationsByProduct[productId] || [],
    createVariation: async (productId, data) => {
      calls.created.push({ productId, data });
      return { id: 900 + calls.created.length };
    },
    updateVariation: async (productId, variationId, data) => {
      calls.updated.push({ productId, variationId, data });
      return { id: variationId };
    },
  };

  return { db, woo, calls, linkStore };
}

const meta = (data, key) => (data.meta_data.find((m) => m.key === key) || {}).value;

test('first synchronization creates one variation with GOS metadata + link', async () => {
  const env = makeEnv();
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.created.length, 1);
  assert.equal(env.calls.updated.length, 0);
  const { productId, data } = env.calls.created[0];
  assert.equal(productId, 101);
  assert.equal(data.status, 'publish');
  assert.equal(data.stock_quantity, 20);
  assert.equal(data.regular_price, '45.00');
  assert.equal(meta(data, META_TOUREVENT_ID), 'slot1');
  assert.equal(meta(data, META_CARD_GROUP_ID), 'cardA');
  assert.equal(env.linkStore['slot1::cardA'].wooVariationId, 901);
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'synced');
});

test('repeated synchronization UPDATES the linked variation — no duplicate', async () => {
  const env = makeEnv({ links: { 'slot1::cardA': { wooVariationId: 555, cardGroupId: 'cardA', wooProductId: 101 } } });
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.created.length, 0, 'never creates a second variation');
  assert.equal(env.calls.updated.length, 1);
  assert.equal(env.calls.updated[0].variationId, 555);
});

test('no duplicate: an unlinked variation is ADOPTED by its _gos_tourevent_id meta', async () => {
  const env = makeEnv({
    variationsByProduct: { 101: [{ id: 777, meta_data: [{ key: META_TOUREVENT_ID, value: 'slot1' }] }] },
  });
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.updated[0].variationId, 777);
  assert.equal(env.linkStore['slot1::cardA'].wooVariationId, 777);
});

test('a TourEvent update (time change) re-syncs the same variation with the new attribute', async () => {
  const env = makeEnv({
    tour: { id: 'slot1', status: 'scheduled', date: '2026-08-08', startTime: '18:30', capacity: 20, openTourTemplateId: 'tpl1', updatedAt: 'u1', wooSyncStatus: 'pending', wooAttempts: 0 },
    links: { 'slot1::cardA': { wooVariationId: 555, cardGroupId: 'cardA', wooProductId: 101 } },
  });
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.deepEqual(env.calls.updated[0].data.attributes, [{ name: 'Date', option: '08.08.2026 18:30' }]);
});

test('cancellation DISABLES the variation (private, 0 stock) and never deletes', async () => {
  const env = makeEnv({
    tour: { id: 'slot1', status: 'cancelled', date: '2026-08-08', startTime: '10:00', capacity: 20, openTourTemplateId: 'tpl1', updatedAt: 'u1', wooSyncStatus: 'pending', wooAttempts: 0 },
    links: { 'slot1::cardA': { wooVariationId: 555, cardGroupId: 'cardA', wooProductId: 101 } },
  });
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.deleted.length, 0);
  assert.equal(env.calls.updated[0].data.status, 'private');
  assert.equal(env.calls.updated[0].data.stock_quantity, 0);
});

test('capacity: stock reflects capacity − active registration seats', async () => {
  const env = makeEnv({ activeSeats: 13 }); // 20 − 13 = 7
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.created[0].data.stock_quantity, 7);
});

test('multiple pricing cards share ONE canonical capacity (no divergent stock)', async () => {
  const env = makeEnv({
    activeSeats: 5, // remaining 15, shared
    templateProducts: [{ cardGroupId: 'cardA' }, { cardGroupId: 'cardB' }],
    mappings: [
      { cardGroupId: 'cardA', wooProductId: 101, active: true },
      { cardGroupId: 'cardB', wooProductId: 102, active: true },
    ],
  });
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.created.length, 2);
  const products = env.calls.created.map((c) => c.productId).sort();
  assert.deepEqual(products, [101, 102]);
  // SAME remaining stock on both sibling ticket products.
  assert.ok(env.calls.created.every((c) => c.data.stock_quantity === 15));
  const cardGroups = env.calls.created.map((c) => meta(c.data, META_CARD_GROUP_ID)).sort();
  assert.deepEqual(cardGroups, ['cardA', 'cardB']);
});

test('a tour with no mapped sellable card is parked as skipped (no Woo calls)', async () => {
  const env = makeEnv({ mappings: [] });
  await reconcileTourWoo({ db: env.db, woo: env.woo, now: 0 }, 'slot1');
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.calls.updated.length, 0);
  assert.equal(env.calls.tourUpdates.at(-1).wooSyncStatus, 'skipped');
});

test('occurrenceClosed respects the close cutoff', () => {
  // 08 Aug 2026 10:00 IL (+03 in Aug) = 07:00Z. close 120min → cutoff 05:00Z.
  const cutoffMs = Date.parse('2026-08-08T05:00:00Z');
  assert.equal(occurrenceClosed('2026-08-08', '10:00', 120, cutoffMs - 60_000), false);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', 120, cutoffMs + 60_000), true);
  assert.equal(occurrenceClosed('2026-08-08', '10:00', null, cutoffMs + 1e9), false); // no rule
});
