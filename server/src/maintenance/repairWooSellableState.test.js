import test from 'node:test';
import assert from 'node:assert/strict';
import { repairWooSellableState } from './repairWooSellableState.js';

// The one-time sellable-state repair over fakes. The critical invariant: it is
// REPAIR-ONLY — it re-pends occurrences that already have WooVariationLinks
// (including cancelled ones, so their variations converge) and NEVER marks a
// never-linked occurrence, so it cannot act as a bulk-publication mechanism.

function makeEnv() {
  const tourUpdates = [];
  const productUpdates = [];
  const linkedTours = [
    { id: 'T-linked-1' },
    { id: 'T-linked-cancelled' },
  ];
  const db = {
    wooProductMapping: {
      findMany: async ({ where }) => {
        const rows = [
          {
            cardGroupId: 'cardA',
            wooProductId: 167,
            active: true,
            config: { date: { attrId: 1 }, time: { attrId: 2 } },
          },
        ];
        return where?.wooProductId ? rows.filter((r) => r.wooProductId === where.wooProductId) : rows;
      },
    },
    openTourTemplateProduct: { findMany: async () => [{ templateId: 'tpl1' }] },
    tourEvent: {
      // The fake honours the linked-only filter: 'T-unlinked' exists but has no
      // links, so a correct where clause must exclude it.
      findMany: async ({ where }) => {
        assert.ok(where.wooVariationLinks?.some, 'repair must filter to LINKED occurrences only');
        assert.equal(where.status, undefined, 'cancelled linked occurrences must also converge');
        return linkedTours;
      },
      updateMany: async (args) => {
        tourUpdates.push(args);
        return { count: args.where.id.in.length };
      },
    },
  };
  const drafted = [];
  const woo = {
    getProduct: async () => ({ id: 167, attributes: [{ id: 1, name: 'תאריך', options: ['15/07/2026'] }] }),
    listVariations: async () => [
      { id: 900, status: 'publish', attributes: [{ id: 1, option: '15-07-2026' }, { id: 2, option: '1800' }], meta_data: [] },
      // orphan GOS variation stuck at 'private' → must be drafted (theme lists private children)
      { id: 901, status: 'private', attributes: [], meta_data: [{ key: '_gos_tourevent_id', value: 'T-linked-1' }] },
      // legacy private variation without GOS meta → must NOT be touched
      { id: 902, status: 'private', attributes: [], meta_data: [] },
    ],
    listAttributeTerms: async () => [{ id: 11, name: '15/07/2026', slug: '15-07-2026', menu_order: 20260715 }],
    updateProduct: async (id, data) => { productUpdates.push({ id, data }); return { id }; },
    updateVariation: async (productId, variationId, data) => { drafted.push({ variationId, ...data }); return { id: variationId }; },
    updateAttributeTerm: async () => ({}),
  };
  return { db, woo, tourUpdates, productUpdates, drafted };
}

test('repair re-pends ONLY linked occurrences (maintenance origin) and reconciles product options', async () => {
  const env = makeEnv();
  const summary = await repairWooSellableState(env.db, env.woo, { log() {}, warn() {} });
  assert.equal(summary.ok, true);
  assert.equal(summary.toursMarkedPending, 2);
  assert.deepEqual(env.tourUpdates[0].where.id.in, ['T-linked-1', 'T-linked-cancelled']);
  assert.equal(env.tourUpdates[0].data.wooSyncOrigin, 'maintenance');
  assert.equal(env.tourUpdates[0].data.wooSyncStatus, 'pending');
  // Options already truthful in this fixture → no product write.
  assert.equal(env.productUpdates.length, 0);
  assert.equal(summary.products[0].changed, false);
  // The private GOS orphan is drafted; the legacy private variation is untouched.
  assert.deepEqual(env.drafted, [{ variationId: 901, status: 'draft' }]);
  assert.deepEqual(summary.products[0].drafted, [901]);
});

test('repair is a no-op without active mappings', async () => {
  const env = makeEnv();
  env.db.wooProductMapping.findMany = async () => [];
  const summary = await repairWooSellableState(env.db, env.woo, { log() {}, warn() {} });
  assert.equal(summary.ok, true);
  assert.equal(env.tourUpdates.length, 0);
});
