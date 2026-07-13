import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperational, resolveBaseVariantId, recomputeTourOperationalProduct } from './operationalProduct.js';

// The generic, capability-based operational-product rule. These tests use
// ABSTRACT component ids (c_tour, c_workshop, c_food) and variant ids — there is
// deliberately no product name anywhere, proving the rule never hardcodes one.

const v = (id, productId, durationHours, comps) => ({
  id,
  productId,
  durationHours,
  activityComponents: comps.map((activityComponentId) => ({ activityComponentId })),
});

test('a single registered variant derives to itself', () => {
  const d = deriveOperational([v('varA', 'pA', 2, ['c_tour'])]);
  assert.equal(d.displayVariantId, 'varA');
  assert.equal(d.displayProductId, 'pA');
  assert.deepEqual(d.componentIds, ['c_tour']);
  assert.equal(d.durationHours, 2);
});

test('base ⊂ base+workshop → the workshop variant is the operational product', () => {
  // The canonical current business, expressed generically: the plain variant
  // has {tour}, the workshop variant has {tour, workshop} and a longer duration.
  const plain = v('varPlain', 'pTour', 2, ['c_tour']);
  const workshop = v('varWorkshop', 'pTour', 3.5, ['c_tour', 'c_workshop']);
  const d = deriveOperational([plain, workshop]);
  assert.equal(d.displayVariantId, 'varWorkshop'); // covers the union, richer
  assert.deepEqual(d.componentIds, ['c_tour', 'c_workshop']);
  assert.equal(d.durationHours, 3.5);
});

test('order of registrations does not change the derived result', () => {
  const plain = v('varPlain', 'pTour', 2, ['c_tour']);
  const workshop = v('varWorkshop', 'pTour', 3.5, ['c_tour', 'c_workshop']);
  const a = deriveOperational([plain, workshop]);
  const b = deriveOperational([workshop, plain]);
  assert.deepEqual(a, b);
});

test('zero workshop registrations (plain only) → plain product', () => {
  const d = deriveOperational([v('varPlain', 'pTour', 2, ['c_tour'])]);
  assert.equal(d.displayVariantId, 'varPlain');
  assert.deepEqual(d.componentIds, ['c_tour']);
});

test('divergent offerings (no single superset) deliver the full union', () => {
  // Two products with partially disjoint capabilities and no covering variant.
  const tourFood = v('varTF', 'p1', 3, ['c_tour', 'c_food']);
  const tourWorkshop = v('varTW', 'p2', 3, ['c_tour', 'c_workshop']);
  const d = deriveOperational([tourFood, tourWorkshop]);
  // Union has all three; both variants have 2 comps + equal duration → the
  // deterministic id tie-break picks one, but the union is always complete.
  assert.deepEqual(new Set(d.componentIds), new Set(['c_tour', 'c_food', 'c_workshop']));
  assert.ok(['varTF', 'varTW'].includes(d.displayVariantId));
});

test('a third sellable product with a NEW capability needs no code change', () => {
  // Proves extensibility: introduce c_photography via a new variant; the union
  // simply grows. No branch in the engine knows what any component "means".
  const base = v('varBase', 'p', 2, ['c_tour']);
  const photo = v('varPhoto', 'p', 4, ['c_tour', 'c_photography']);
  const d = deriveOperational([base, photo]);
  assert.equal(d.displayVariantId, 'varPhoto');
  assert.deepEqual(d.componentIds, ['c_tour', 'c_photography']);
  assert.equal(d.durationHours, 4);
});

test('empty input derives to null (nothing to derive from)', () => {
  assert.equal(deriveOperational([]), null);
  assert.equal(deriveOperational(null), null);
});

// ── Regression: plain-only slot must NOT derive to Workshop (the reported bug) ─
// Root cause: the base fallback used isDefault (which can be the workshop
// product), and card-priced group deals register a NULL variant that the
// derivation filter drops. The base must be the PLAIN product (no isWorkshop).

test('resolveBaseVariantId picks the PLAIN offered product even when workshop is isDefault', async () => {
  const client = {
    openTourTemplateProduct: {
      findMany: async () => [
        { isDefault: true, productVariantId: 'workshop', productVariant: { activityComponents: [{ activityComponent: { isWorkshop: true } }] } },
        { isDefault: false, productVariantId: 'plain', productVariant: { activityComponents: [{ activityComponent: { isWorkshop: false } }] } },
      ],
    },
  };
  assert.equal(await resolveBaseVariantId(client, 'tpl1'), 'plain');
});

test('resolveBaseVariantId falls back to isDefault when EVERY offered product is a workshop', async () => {
  const client = {
    openTourTemplateProduct: {
      findMany: async () => [
        { isDefault: false, productVariantId: 'w1', productVariant: { activityComponents: [{ activityComponent: { isWorkshop: true } }] } },
        { isDefault: true, productVariantId: 'w2', productVariant: { activityComponents: [{ activityComponent: { isWorkshop: true } }] } },
      ],
    },
  };
  assert.equal(await resolveBaseVariantId(client, 'tpl1'), 'w2');
});

test('recompute: a slot with only null-variant (card-priced) plain regs derives to PLAIN, not Workshop', async () => {
  const updates = [];
  const client = {
    tourEvent: {
      findUnique: async () => ({
        id: 'slot1', kind: 'group_slot', status: 'scheduled', productManualOverride: false,
        openTourTemplateId: 'tpl1', productId: 'pW', productVariantId: 'workshop', // stale workshop base
      }),
      update: async ({ data }) => { updates.push(data); return {}; },
    },
    // Active registrations exist but carry a null variant → filtered out here.
    ticketRegistration: { findMany: async () => [] },
    openTourTemplateProduct: {
      findMany: async () => [
        { isDefault: true, productVariantId: 'workshop', productVariant: { activityComponents: [{ activityComponent: { isWorkshop: true } }] } },
        { isDefault: false, productVariantId: 'plain', productVariant: { activityComponents: [{ activityComponent: { isWorkshop: false } }] } },
      ],
    },
    productVariant: {
      findMany: async () => [{ id: 'plain', productId: 'pP', durationHours: 2, activityComponents: [{ activityComponentId: 'c_tour' }] }],
    },
    tourEventActivityComponent: {
      findMany: async () => [{ id: 'te1', activityComponentId: 'c_workshop' }], // lingering workshop row
      deleteMany: async () => ({ count: 1 }),
      createMany: async () => ({ count: 1 }),
    },
  };
  const result = await recomputeTourOperationalProduct(client, 'slot1');
  assert.equal(result.displayVariantId, 'plain');
  assert.equal(updates[0].productVariantId, 'plain'); // slot flips workshop → plain
});
