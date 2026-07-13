import test from 'node:test';
import assert from 'node:assert/strict';
import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { reconcileAllOpenTourProducts } from './reconcileProducts.js';

// Full-recomputation regression for the workshop-derivation bug. Uses a stateful
// fake so we assert the PERSISTED product/variant/components after reconcile —
// derivation must be a full recomputation (stale workshop state is removed), not
// additive. Catalog: v_plain = {c_tour}; v_ws = {c_tour, c_ws(isWorkshop)}.

const IS_WS = { c_tour: false, c_ws: true };
const CATALOG = {
  v_plain: { productId: 'p_plain', durationHours: 2, comps: ['c_tour'] },
  v_ws: { productId: 'p_ws', durationHours: 3.5, comps: ['c_tour', 'c_ws'] },
};
const CAP = ['active', 'held', 'confirmed'];

function fakeClient({ tour = {}, regs = [], offered, components = [] }) {
  // Default template offers BOTH, with the WORKSHOP variant flagged isDefault —
  // proving the base is chosen by capability (plain), not the flag.
  offered = offered || [
    { productVariantId: 'v_plain', isDefault: false },
    { productVariantId: 'v_ws', isDefault: true },
  ];
  const state = {
    tour: {
      id: 'slot1', kind: 'group_slot', status: 'scheduled', productManualOverride: false,
      openTourTemplateId: 'tpl1', productId: null, productVariantId: null, ...tour,
    },
    components: components.map((cid, i) => ({ id: `te_${i}`, activityComponentId: cid })),
    wooMarks: 0,
  };
  return {
    state,
    tourEvent: {
      findUnique: async () => ({ ...state.tour }),
      update: async ({ data }) => { Object.assign(state.tour, data); return { ...state.tour }; },
      updateMany: async () => { state.wooMarks += 1; return { count: 1 }; },
      findMany: async () => [{ id: state.tour.id, productManualOverride: state.tour.productManualOverride }],
    },
    ticketRegistration: {
      findMany: async () =>
        regs.filter((r) => CAP.includes(r.status) && r.productVariantId != null).map((r) => ({ productVariantId: r.productVariantId })),
    },
    openTourTemplateProduct: {
      findMany: async () =>
        offered.map((o) => ({
          isDefault: o.isDefault,
          productVariantId: o.productVariantId,
          productVariant: {
            activityComponents: (CATALOG[o.productVariantId]?.comps || []).map((cid) => ({
              activityComponent: { isWorkshop: IS_WS[cid] },
            })),
          },
        })),
      findFirst: async ({ where }) => (offered.some((o) => o.productVariantId === where.productVariantId) ? { id: 'x' } : null),
    },
    productVariant: {
      findMany: async ({ where }) =>
        where.id.in.map((id) => ({
          id,
          productId: CATALOG[id].productId,
          durationHours: CATALOG[id].durationHours,
          activityComponents: CATALOG[id].comps.map((cid) => ({ activityComponentId: cid })),
        })),
    },
    tourEventActivityComponent: {
      findMany: async () => state.components.map((c) => ({ id: c.id, activityComponentId: c.activityComponentId })),
      deleteMany: async ({ where }) => {
        state.components = state.components.filter((c) => !where.id.in.includes(c.id));
        return { count: where.id.in.length };
      },
      createMany: async ({ data }) => {
        for (const d of data) state.components.push({ id: `te_new_${state.components.length}`, activityComponentId: d.activityComponentId });
        return { count: data.length };
      },
    },
  };
}

const showsWorkshop = (s) => s.tour.productId === 'p_ws' || s.components.some((c) => IS_WS[c.activityComponentId]);

test('1. plain-only registrations → plain tour', async () => {
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.equal(c.state.tour.productId, 'p_plain');
  assert.ok(!showsWorkshop(c.state));
});

test('2. workshop registration added → workshop tour', async () => {
  const c = fakeClient({ tour: { productId: 'p_plain', productVariantId: 'v_plain' }, regs: [{ status: 'active', productVariantId: 'v_plain' }, { status: 'active', productVariantId: 'v_ws' }], components: ['c_tour'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.equal(c.state.tour.productId, 'p_ws');
  assert.ok(showsWorkshop(c.state));
});

test('3. last workshop registration cancelled → reverts to plain', async () => {
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }, { status: 'cancelled', productVariantId: 'v_ws' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.ok(!showsWorkshop(c.state));
});

test('4. last workshop registration expired → reverts to plain', async () => {
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }, { status: 'expired', productVariantId: 'v_ws' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.ok(!showsWorkshop(c.state));
});

test('5. workshop registration changed to plain → reverts to plain', async () => {
  // The registration row was updated v_ws → v_plain; recompute sees only plain.
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.ok(!showsWorkshop(c.state));
});

test('6. stale persisted workshop product is OVERWRITTEN by recomputation', async () => {
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.equal(c.state.tour.productVariantId, 'v_plain');
  assert.deepEqual(c.state.components.map((x) => x.activityComponentId).sort(), ['c_tour']); // c_ws removed
});

test('7. null-variant plain Deal registration does NOT fall back to workshop', async () => {
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: null }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1'); // base resolves to plain (no isWorkshop)
  assert.equal(c.state.tour.productId, 'p_plain');
  assert.ok(!showsWorkshop(c.state));
});

test('8a. an INACTIVE pin (override=false) does not block derivation', async () => {
  const c = fakeClient({ tour: { productManualOverride: false, productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.ok(!showsWorkshop(c.state));
});

test('8b. a STALE/invalid pin (variant no longer offered) is cleared, then recomputed', async () => {
  const c = fakeClient({ tour: { productManualOverride: true, productId: 'p_gone', productVariantId: 'v_gone' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.equal(c.state.tour.productManualOverride, false); // stale pin cleared
  assert.ok(!showsWorkshop(c.state));
});

test('8c. a VALID pin (pinned variant still offered) is honored (force=false)', async () => {
  const c = fakeClient({ tour: { productManualOverride: true, productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  const res = await recomputeTourOperationalProduct(c, 'slot1');
  assert.equal(res.pinned, true);
  assert.equal(c.state.tour.productVariantId, 'v_ws'); // operator pin preserved
});

test('9. product change marks the calendar pending + Woo dirty (DTO/calendar read canonical)', async () => {
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  await recomputeTourOperationalProduct(c, 'slot1');
  assert.equal(c.state.tour.gcalSyncStatus, 'pending'); // calendar re-derives from the new product
  assert.ok(c.state.wooMarks >= 1); // Woo mirror marked dirty
});

test('10. reconcileAllOpenTourProducts heals a stale materialized tour', async () => {
  // realign is covered separately (realignReconcile.test.js) with its own fake;
  // here we assert the recompute-driven heal of a stale persisted product.
  const c = fakeClient({ tour: { productId: 'p_ws', productVariantId: 'v_ws' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour', 'c_ws'] });
  const summary = await reconcileAllOpenTourProducts(c, { realign: false });
  assert.equal(summary.scanned, 1);
  assert.equal(summary.changed, 1);
  assert.ok(!showsWorkshop(c.state));
});

test('11. idempotent: an already-correct plain tour is NOT re-marked dirty', async () => {
  // Already plain (product p_plain, only c_tour). Recompute must change nothing.
  const c = fakeClient({ tour: { productId: 'p_plain', productVariantId: 'v_plain' }, regs: [{ status: 'active', productVariantId: 'v_plain' }], components: ['c_tour'] });
  const res = await recomputeTourOperationalProduct(c, 'slot1');
  assert.ok(!res.changed);
  assert.equal(c.state.wooMarks, 0); // Woo not marked dirty
  assert.notEqual(c.state.tour.gcalSyncStatus, 'pending'); // calendar not marked
});
