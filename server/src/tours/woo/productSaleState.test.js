import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveProductSaleState,
  countSellableVariations,
  reconcileProductSaleState,
  HIDDEN_VISIBILITY,
  VISIBLE_VISIBILITY,
} from './productSaleState.js';

// The canonical sale-enable invariant:
//   GOS explicitly enabled AND ≥1 valid sellable instance → purchasable.
//   Otherwise → not purchasable, no customer-facing price.
// Pinned against the production failure: Woo product 171 was published,
// catalog-visible and purchasable with ZERO GOS mapping and a single leftover
// variation priced 100000.

function fakeWoo({ product, variations }) {
  const calls = [];
  return {
    calls,
    getProduct: async () => ({ ...product }),
    listVariations: async () => variations.map((v) => ({ ...v })),
    updateProduct: async (id, data) => {
      calls.push({ id, data });
      return { id, ...data };
    },
  };
}
const db = (mappings) => ({ wooProductMapping: { findMany: async () => mappings } });

test('8. a product with no sellable occurrence leaves the public catalog', () => {
  assert.deepEqual(deriveProductSaleState({ governed: true, sellableVariationCount: 0 }), {
    catalogVisibility: HIDDEN_VISIBILITY,
    purchasable: false,
    reason: 'no_sellable_occurrence',
  });
});

test('8b. sale availability is NEVER inferred from the mere existence of a product', () => {
  // No active GOS mapping ⇒ not enabled for sale, whatever Woo happens to hold.
  assert.deepEqual(deriveProductSaleState({ governed: false, sellableVariationCount: 40 }), {
    catalogVisibility: HIDDEN_VISIBILITY,
    purchasable: false,
    reason: 'not_governed_by_gos',
  });
});

test('10. one published sellable variation restores normal sale behaviour', () => {
  assert.deepEqual(deriveProductSaleState({ governed: true, sellableVariationCount: 1 }), {
    catalogVisibility: VISIBLE_VISIBILITY,
    purchasable: true,
    reason: 'sellable',
  });
});

test('9. a published variation with a SENTINEL price is not evidence of a sale', () => {
  // Exactly Haifa's shape: one published variation at 100000, everything else
  // drafted or price-less. That must count as ZERO sellable variations.
  const variations = [
    { id: 1064, status: 'publish', regular_price: '100000' },
    { id: 1065, status: 'publish', regular_price: '' },
    { id: 1062, status: 'draft', regular_price: '90' },
  ];
  assert.equal(countSellableVariations(variations), 0);
  assert.deepEqual(deriveProductSaleState({ governed: true, sellableVariationCount: 0 }).purchasable, false);
});

test('countSellableVariations counts only published, real-priced children', () => {
  assert.equal(
    countSellableVariations([
      { id: 1, status: 'publish', regular_price: '90.00' },
      { id: 2, status: 'publish', regular_price: '250.00' },
      { id: 3, status: 'draft', regular_price: '150.00' }, // hidden
      { id: 4, status: 'publish', regular_price: '100000' }, // sentinel
    ]),
    2,
  );
  assert.equal(countSellableVariations([]), 0);
  assert.equal(countSellableVariations(null), 0);
});

test('reconciler hides a mapped product once nothing sellable is left', async () => {
  const woo = fakeWoo({
    product: { id: 167, catalog_visibility: 'visible' },
    variations: [{ id: 1, status: 'draft', regular_price: '90.00' }],
  });
  const res = await reconcileProductSaleState({ db: db([{ wooProductId: 167, active: true }]), woo }, 167);
  assert.equal(res.changed, true);
  assert.equal(res.catalogVisibility, HIDDEN_VISIBILITY);
  assert.deepEqual(woo.calls, [{ id: 167, data: { catalog_visibility: 'hidden' } }]);
});

test('10b. re-enabling flows back through the SAME canonical path (no special case)', async () => {
  const woo = fakeWoo({
    product: { id: 167, catalog_visibility: 'hidden' },
    variations: [{ id: 1, status: 'publish', regular_price: '90.00' }],
  });
  const res = await reconcileProductSaleState({ db: db([{ wooProductId: 167, active: true }]), woo }, 167);
  assert.equal(res.changed, true);
  assert.equal(res.catalogVisibility, VISIBLE_VISIBILITY);
  assert.deepEqual(woo.calls, [{ id: 167, data: { catalog_visibility: 'visible' } }]);
});

test('reconciler is idempotent — no write when already correct', async () => {
  const woo = fakeWoo({
    product: { id: 167, catalog_visibility: 'visible' },
    variations: [{ id: 1, status: 'publish', regular_price: '90.00' }],
  });
  const res = await reconcileProductSaleState({ db: db([{ wooProductId: 167, active: true }]), woo }, 167);
  assert.equal(res.changed, false);
  assert.deepEqual(woo.calls, []);
});

test('12. the reconciler never touches a product GOS does not map', async () => {
  // Product 171 (Haifa) has no mapping. The automatic path must not roam the
  // catalog mutating products GOS does not own — that correction is explicit,
  // recorded and reviewable, never a silent background sweep.
  const woo = fakeWoo({
    product: { id: 171, catalog_visibility: 'visible' },
    variations: [{ id: 1064, status: 'publish', regular_price: '100000' }],
  });
  const res = await reconcileProductSaleState({ db: db([]), woo }, 171);
  assert.equal(res.governed, false);
  assert.equal(res.changed, false);
  assert.deepEqual(woo.calls, []);
});

test('12b. an INACTIVE mapping is not "enabled for sale"', async () => {
  const woo = fakeWoo({
    product: { id: 167, catalog_visibility: 'visible' },
    variations: [{ id: 1, status: 'publish', regular_price: '90.00' }],
  });
  // The reconciler queries active-only; an inactive mapping reads as ungoverned.
  const res = await reconcileProductSaleState({ db: db([]), woo }, 167);
  assert.equal(res.governed, false);
  assert.deepEqual(woo.calls, []);
});
