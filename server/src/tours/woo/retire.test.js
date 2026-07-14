import test from 'node:test';
import assert from 'node:assert/strict';
import { retireMapping } from './retire.js';

// Canonical retirement over fakes: it drafts ONLY the variations the card's
// mapping manages (via WooVariationLink), disables those links while keeping
// their ids (history), and reconciles product options — never touching a sibling
// card on the same product or legacy/manual variations.

function makeEnv() {
  const updatedVariations = [];
  const linkUpdateManys = [];
  // cardTour manages variations 100/101; sibling cardWs manages 200/201; 999 is legacy.
  const links = [
    { id: 'l1', cardGroupId: 'cardTour', wooProductId: 167, wooVariationId: 100, variantKey: 'adult', status: 'synced' },
    { id: 'l2', cardGroupId: 'cardTour', wooProductId: 167, wooVariationId: 101, variantKey: 'child', status: 'synced' },
    { id: 'l3', cardGroupId: 'cardWs', wooProductId: 167, wooVariationId: 200, variantKey: 'adult', status: 'synced' },
    { id: 'l4', cardGroupId: 'cardWs', wooProductId: 167, wooVariationId: 201, variantKey: 'child', status: 'synced' },
  ];
  const client = {
    wooProductMapping: {
      findUnique: async ({ where }) => (where.cardGroupId === 'cardTour' ? { cardGroupId: 'cardTour', wooProductId: 167, config: { date: { attrId: 1 } } } : null),
      findMany: async () => [{ cardGroupId: 'cardWs', wooProductId: 167, active: true, config: { date: { attrId: 1 } } }], // sibling still mapped
    },
    wooVariationLink: {
      findMany: async ({ where }) =>
        links.filter((l) => l.cardGroupId === where.cardGroupId && l.wooProductId === where.wooProductId && l.wooVariationId != null && l.status !== 'disabled'),
      updateMany: async ({ where, data }) => {
        linkUpdateManys.push({ where, data });
        let count = 0;
        for (const l of links) if (l.cardGroupId === where.cardGroupId && l.status !== 'disabled') { l.status = data.status; count++; }
        return { count };
      },
    },
    _links: links,
  };
  const woo = {
    updateVariation: async (pid, vid, data) => { updatedVariations.push({ pid, vid, status: data.status, stock: data.stock_quantity }); return { id: vid }; },
    // reconcileProductOptions surface — product declares no managed attribute, so it no-ops.
    getProduct: async () => ({ id: 167, attributes: [] }),
    listVariations: async () => [],
    listAttributeTerms: async () => [],
    updateProduct: async () => ({}),
    updateAttributeTerm: async () => ({}),
  };
  return { client, woo, updatedVariations, linkUpdateManys };
}

const silent = { log() {}, warn() {} };

test('retires ONLY the card mapping variations (draft + 0 stock), leaving sibling + legacy untouched', async () => {
  const env = makeEnv();
  const r = await retireMapping(env.client, env.woo, 'cardTour', { log: silent });
  assert.equal(r.ok, true);
  assert.deepEqual(r.disabledIds.sort(), [100, 101]);
  // Exactly the two managed variations drafted with 0 stock — never 200/201/999.
  assert.deepEqual(env.updatedVariations.map((u) => u.vid).sort(), [100, 101]);
  assert.ok(env.updatedVariations.every((u) => u.status === 'draft' && u.stock === 0));
});

test('disables the card links (history preserved) and leaves the sibling links synced', async () => {
  const env = makeEnv();
  await retireMapping(env.client, env.woo, 'cardTour', { log: silent });
  const byId = Object.fromEntries(env.client._links.map((l) => [l.id, l.status]));
  assert.equal(byId.l1, 'disabled');
  assert.equal(byId.l2, 'disabled');
  assert.equal(byId.l3, 'synced', 'sibling card untouched');
  assert.equal(byId.l4, 'synced');
  // The disabled links keep their wooVariationId so a restore can re-adopt them.
  assert.equal(env.client._links.find((l) => l.id === 'l1').wooVariationId, 100);
});

test('a missing mapping is a no-op error, nothing drafted', async () => {
  const env = makeEnv();
  const r = await retireMapping(env.client, env.woo, 'doesNotExist', { log: silent });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'mapping_not_found');
  assert.equal(env.updatedVariations.length, 0);
});

test('a Woo draft failure on one variation does not abort the rest; links still disabled', async () => {
  const env = makeEnv();
  let calls = 0;
  env.woo.updateVariation = async (pid, vid) => { calls++; if (vid === 100) throw new Error('404 gone'); return { id: vid }; };
  const r = await retireMapping(env.client, env.woo, 'cardTour', { log: silent });
  assert.equal(r.ok, true);
  assert.deepEqual(r.disabledIds, [101], 'only the one that succeeded is reported drafted');
  assert.equal(calls, 2, 'both were attempted');
  assert.equal(env.client._links.find((l) => l.id === 'l1').status, 'disabled', 'link still disabled despite Woo 404');
});
