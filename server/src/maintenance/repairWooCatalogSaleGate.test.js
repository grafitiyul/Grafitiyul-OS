import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogViolation, repairWooCatalogSaleGate } from './repairWooCatalogSaleGate.js';

// Pinned against the LIVE catalog as it stood on 06.08.2026:
//   167 סיור וסדנת גרפיטי בתל אביב — GOS-mapped, sellable        → untouched
//   169 קירות של תקווה             — ungoverned, unpurchasable    → untouched
//   170 סיור גרפיטי בירושלים       — ungoverned, unpurchasable    → untouched
//   171 סיור גרפיטי בחיפה          — ungoverned, PURCHASABLE @100000 → corrected

const HAIFA = {
  id: 171, name: 'סיור גרפיטי בחיפה', type: 'variable',
  status: 'publish', catalog_visibility: 'visible', purchasable: true, price: '100000',
};
const HAIFA_VARIATIONS = [
  { id: 1064, status: 'publish', regular_price: '100000' },
  { id: 1065, status: 'publish', regular_price: '' },
  { id: 1062, status: 'draft', regular_price: '90' },
];
const JERUSALEM = {
  id: 170, name: 'סיור גרפיטי בירושלים', type: 'variable',
  status: 'publish', catalog_visibility: 'visible', purchasable: false, price: '',
};
const TEL_AVIV = {
  id: 167, name: 'סיור וסדנת גרפיטי בתל אביב', type: 'variable',
  status: 'publish', catalog_visibility: 'visible', purchasable: true, price: '90.00',
};

test('the Haifa shape is a violation — purchasable AND showing a placeholder price', () => {
  const v = catalogViolation({ product: HAIFA, variations: HAIFA_VARIATIONS });
  assert.ok(v);
  assert.deepEqual(v.sentinelVariationIds, [1064]);
  assert.deepEqual(v.reasons, ['purchasable_without_gos_approval', 'placeholder_price_visible_to_customers']);
});

test('an ungoverned but unpurchasable, price-less product is NOT a violation', () => {
  // GOS does not own these; hiding them would be seizing a surface it does not
  // control, and they show no price and no purchase path.
  assert.equal(catalogViolation({ product: JERUSALEM, variations: [] }), null);
});

function fakeWoo(products, variationsByProduct) {
  const calls = { productUpdates: [], variationUpdates: [] };
  return {
    calls,
    listProducts: async ({ page }) => (page === 1 ? products : []),
    listVariations: async (id) => variationsByProduct[id] || [],
    updateProduct: async (id, data) => calls.productUpdates.push({ id, data }),
    updateVariation: async (pid, vid, data) => calls.variationUpdates.push({ pid, vid, data }),
  };
}
const db = (mappings) => ({ wooProductMapping: { findMany: async () => mappings } });
const silent = { log: () => {}, warn: () => {} };

test('corrects ONLY the violating ungoverned product, and leaves the rest alone', async () => {
  const woo = fakeWoo([TEL_AVIV, JERUSALEM, HAIFA], { 171: HAIFA_VARIATIONS, 170: [] });
  const res = await repairWooCatalogSaleGate(db([{ wooProductId: 167, active: true }]), woo, { log: silent });

  assert.equal(res.corrected.length, 1);
  assert.equal(res.corrected[0].productId, 171);

  // Haifa: sentinel variation drafted + zero stock, product out of the catalog.
  assert.deepEqual(woo.calls.variationUpdates, [
    { pid: 171, vid: 1064, data: { status: 'draft', manage_stock: true, stock_quantity: 0, stock_status: 'outofstock' } },
  ]);
  assert.deepEqual(woo.calls.productUpdates, [{ id: 171, data: { catalog_visibility: 'hidden' } }]);

  // Tel Aviv (governed) and Jerusalem (ungoverned but harmless) untouched.
  assert.equal(woo.calls.productUpdates.filter((c) => c.id !== 171).length, 0);
});

test('never invents a price and never deletes anything', async () => {
  const woo = fakeWoo([HAIFA], { 171: HAIFA_VARIATIONS });
  await repairWooCatalogSaleGate(db([]), woo, { log: silent });
  for (const c of woo.calls.variationUpdates) {
    assert.equal('regular_price' in c.data, false, 'must not rewrite the price');
    assert.equal('price' in c.data, false);
  }
  for (const c of woo.calls.productUpdates) {
    assert.deepEqual(Object.keys(c.data), ['catalog_visibility'], 'only the visibility flag changes');
  }
  assert.equal(typeof woo.deleteProduct, 'undefined');
  assert.equal(typeof woo.deleteVariation, 'undefined');
});

test('a GOVERNED product is never corrected here, whatever its state', async () => {
  // Product 171 with an ACTIVE mapping is GOS's to manage through the normal
  // sync path — this job must not second-guess it.
  const woo = fakeWoo([HAIFA], { 171: HAIFA_VARIATIONS });
  const res = await repairWooCatalogSaleGate(db([{ wooProductId: 171, active: true }]), woo, { log: silent });
  assert.equal(res.corrected.length, 0);
  assert.deepEqual(woo.calls.productUpdates, []);
  assert.deepEqual(woo.calls.variationUpdates, []);
});

test('dry-run reports exactly what it would do and writes nothing', async () => {
  const woo = fakeWoo([HAIFA], { 171: HAIFA_VARIATIONS });
  const res = await repairWooCatalogSaleGate(db([]), woo, { log: silent, dryRun: true });
  assert.equal(res.dryRun, true);
  assert.deepEqual(res.corrected[0].draftedVariationIds, [1064]);
  assert.deepEqual(woo.calls.productUpdates, []);
  assert.deepEqual(woo.calls.variationUpdates, []);
});

test('12. GOS↔Woo mappings are read, never written', async () => {
  let wrote = false;
  const client = {
    wooProductMapping: {
      findMany: async () => [],
      update: async () => { wrote = true; },
      delete: async () => { wrote = true; },
      deleteMany: async () => { wrote = true; },
    },
  };
  await repairWooCatalogSaleGate(client, fakeWoo([HAIFA], { 171: HAIFA_VARIATIONS }), { log: silent });
  assert.equal(wrote, false);
});
