import test from 'node:test';
import assert from 'node:assert/strict';
import { resyncDealGroupTours } from './tourFromDeal.js';

// PART 1 regression: editing a group Deal's Group Ticket Builder AFTER a
// registration exists must IMMEDIATELY re-derive the tour's operational product —
// including the case the old path missed: a still-OPEN HELD reservation (no
// booking). Catalog: v_plain = {c_tour}; v_ws = {c_tour, c_ws(isWorkshop)}.

const IS_WS = { c_tour: false, c_ws: true };
const CATALOG = {
  v_plain: { productId: 'p_plain', durationHours: 2, comps: ['c_tour'] },
  v_ws: { productId: 'p_ws', durationHours: 3.5, comps: ['c_tour', 'c_ws'] },
};
const CAP = ['active', 'held', 'confirmed'];

// A stateful fake. The deal starts on a plain tour with a HELD reservation; its
// working quote now carries a WORKSHOP card. resyncDealGroupTours must realign
// the held reg → v_ws and recompute the tour to workshop.
function fakeClient({ heldVariant = 'v_plain', cardVariant = 'v_ws', booking = null } = {}) {
  const state = {
    deal: { id: 'd1', activityType: 'group', productVariantId: 'v_plain' },
    tour: { id: 'slot1', kind: 'group_slot', status: 'scheduled', productManualOverride: false, openTourTemplateId: 'tpl1', productId: 'p_plain', productVariantId: 'v_plain' },
    reg: { id: 'reg1', dealId: 'd1', tourEventId: 'slot1', source: 'deal', status: 'held', productVariantId: heldVariant, ticketBreakdown: null, quantity: 5 },
    components: [{ id: 'te_0', activityComponentId: 'c_tour' }],
    updated: null,
    recomputed: false,
  };
  const offered = [
    { productVariantId: 'v_plain', isDefault: false },
    { productVariantId: 'v_ws', isDefault: false },
  ];
  return {
    state,
    deal: { findUnique: async () => ({ ...state.deal }) },
    booking: { findFirst: async () => booking },
    ticketRegistration: {
      // Two shapes: the resync scan (has tourEvent filter) vs recompute's read.
      findMany: async ({ where }) => {
        if (where.tourEvent) return [{ tourEventId: state.reg.tourEventId }];
        // recompute reads active-variant registrations
        return [state.reg].filter((r) => CAP.includes(r.status) && r.productVariantId != null).map((r) => ({ productVariantId: r.productVariantId }));
      },
      updateMany: async ({ data }) => {
        Object.assign(state.reg, data);
        state.updated = { ...data };
        return { count: 1 };
      },
    },
    quoteVersion: { findFirst: async () => ({ id: 'qv1' }) },
    quoteLine: {
      findMany: async () => [
        { sourceCardGroupId: 'c_ws', productVariantId: cardVariant, quantity: 5, ticketTypeId: 't_a', ticketType: { nameHe: 'מבוגר' } },
      ],
    },
    priceRule: { findMany: async ({ where }) => (where.cardGroupId.in.includes('c_ws') ? [{ cardGroupId: 'c_ws', product: { nameHe: 'סיור + סדנה' } }] : []) },
    productVariant: {
      findMany: async ({ where }) =>
        where.id.in.map((id) => ({
          id,
          productId: CATALOG[id].productId,
          durationHours: CATALOG[id].durationHours,
          activityComponents: CATALOG[id].comps.map((cid) => ({ activityComponentId: cid })),
        })),
    },
    tourEvent: {
      findUnique: async () => ({ ...state.tour }),
      update: async ({ data }) => { Object.assign(state.tour, data); state.recomputed = true; return { ...state.tour }; },
      updateMany: async () => ({ count: 1 }), // markTourWooPending
    },
    openTourTemplateProduct: {
      findMany: async () =>
        offered.map((o) => ({
          isDefault: o.isDefault,
          productVariantId: o.productVariantId,
          productVariant: { activityComponents: CATALOG[o.productVariantId].comps.map((cid) => ({ activityComponent: { isWorkshop: IS_WS[cid] } })) },
        })),
      findFirst: async ({ where }) => (offered.some((o) => o.productVariantId === where.productVariantId) ? { id: 'x' } : null),
    },
    tourEventActivityComponent: {
      findMany: async () => state.components.map((c) => ({ id: c.id, activityComponentId: c.activityComponentId })),
      deleteMany: async ({ where }) => { state.components = state.components.filter((c) => !where.id.in.includes(c.id)); return { count: where.id.in.length }; },
      createMany: async ({ data }) => { for (const d of data) state.components.push({ id: `te_${state.components.length}`, activityComponentId: d.activityComponentId }); return { count: data.length }; },
    },
  };
}

const showsWorkshop = (s) => s.tour.productId === 'p_ws' || s.components.some((c) => IS_WS[c.activityComponentId]);

test('a HELD reservation (no booking) is realigned to the new WORKSHOP card + tour recomputes to workshop', async () => {
  const c = fakeClient({ heldVariant: 'v_plain', cardVariant: 'v_ws', booking: null });
  const tourIds = await resyncDealGroupTours(c, 'd1', {});
  assert.deepEqual(tourIds, ['slot1']);
  // The held reg was realigned to the dominant card variant + carries the breakdown.
  assert.equal(c.state.reg.productVariantId, 'v_ws');
  assert.ok(Array.isArray(c.state.reg.ticketBreakdown) && c.state.reg.ticketBreakdown.length === 1);
  assert.equal(c.state.reg.ticketBreakdown[0].cardTitle, 'סיור + סדנה');
  // The tour re-derived to workshop.
  assert.equal(c.state.tour.productId, 'p_ws');
  assert.ok(showsWorkshop(c.state));
});

test('a plain-only card selection keeps the held reg + tour plain (idempotent re-derive)', async () => {
  const c = fakeClient({ heldVariant: 'v_plain', cardVariant: 'v_plain', booking: null });
  await resyncDealGroupTours(c, 'd1', {});
  assert.equal(c.state.reg.productVariantId, 'v_plain');
  assert.equal(c.state.tour.productId, 'p_plain');
  assert.ok(!showsWorkshop(c.state));
});

test('a non-group deal is a no-op', async () => {
  const c = fakeClient();
  c.state.deal.activityType = 'private';
  const tourIds = await resyncDealGroupTours(c, 'd1', {});
  assert.deepEqual(tourIds, []);
});
