import test from 'node:test';
import assert from 'node:assert/strict';
import { lineToData } from '../quote/quoteLineMapping.js';
import { resyncDealGroupTours } from './tourFromDeal.js';

// INTEGRATION test for the EXACT data path the inline Group Ticket Builder runs
// via PUT /api/deals/:id/price-lines:
//   builder lines → lineToData → persisted QuoteLine rows
//     → resolveDealGroupOffering (dominant card variant + breakdown)
//       → resyncDealGroupTours (realign registration + recompute tour product)
// It uses the REAL lineToData / resolveDealGroupOffering / resyncDealGroupTours /
// recomputeTourOperationalProduct — only the DB is faked — so it catches the
// BUG-1 regression: a workshop ticket that never flipped the tour because its
// QuoteLine.productVariantId was dropped. Verifies BOTH directions.

const IS_WS = { c_tour: false, c_ws: true };
const CATALOG = {
  v_plain: { productId: 'p_plain', durationHours: 2, comps: ['c_tour'] },
  v_ws: { productId: 'p_ws', durationHours: 3.5, comps: ['c_tour', 'c_ws'] },
};
const CARD_TITLE = { c_plain: 'סיור גרפיטי', c_ws: 'סיור גרפיטי + סדנה' };
const TT_LABEL = { t_adult: 'מבוגר', t_child: 'ילד' };
const CAP = ['active', 'held', 'confirmed'];

// A builder line exactly as GroupTicketBuilder.jsx emits it (kind='manual',
// carrying the card's productVariantId).
function builderLine({ card, tt, qty, variant }) {
  return {
    kind: 'manual',
    label: `${CARD_TITLE[card]} — ${TT_LABEL[tt]}`,
    refId: null,
    quantity: qty,
    unitPriceMinor: 12000,
    vatMode: 'included',
    vatRate: 18,
    active: true,
    overridden: false,
    sourceKind: 'group_ticket',
    sourceCardGroupId: card,
    ticketTypeId: tt,
    productVariantId: variant,
  };
}

function fake({ regStatus = 'confirmed', booking = null } = {}) {
  const state = {
    deal: { id: 'd1', activityType: 'group', productVariantId: 'v_plain' },
    tour: { id: 'slot1', kind: 'group_slot', status: 'scheduled', productManualOverride: false, openTourTemplateId: 'tpl1', productId: 'p_plain', productVariantId: 'v_plain' },
    reg: { id: 'reg1', dealId: 'd1', tourEventId: 'slot1', source: 'deal', status: regStatus, bookingId: booking ? 'bk1' : null, productVariantId: 'v_plain', ticketBreakdown: null, quantity: 3 },
    lines: [], // the working version's QuoteLines (persisted via lineToData)
    components: [{ id: 'te_0', activityComponentId: 'c_tour' }],
  };
  const offered = [
    { productVariantId: 'v_plain', isDefault: false },
    { productVariantId: 'v_ws', isDefault: false },
  ];
  const client = {
    state,
    deal: { findUnique: async () => ({ ...state.deal }) },
    booking: {
      findFirst: async () => booking,
      update: async ({ data }) => { if (booking) Object.assign(booking, data); return booking; },
    },
    quoteVersion: { findFirst: async () => ({ id: 'qv1' }) },
    quoteLine: {
      deleteMany: async () => { const n = state.lines.length; state.lines = []; return { count: n }; },
      createMany: async ({ data }) => { for (const d of data) state.lines.push(d); return { count: data.length }; },
      // resolveDealGroupOffering's shape: filter group_ticket/active/qty>0 + join ticketType.
      findMany: async () =>
        state.lines
          .filter((l) => l.sourceKind === 'group_ticket' && l.active !== false && (l.quantity || 0) > 0)
          .map((l) => ({
            sourceCardGroupId: l.sourceCardGroupId,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            ticketTypeId: l.ticketTypeId,
            ticketType: { nameHe: TT_LABEL[l.ticketTypeId] || 'כרטיס' },
          })),
    },
    priceRule: { findMany: async ({ where }) => where.cardGroupId.in.filter((c) => CARD_TITLE[c]).map((c) => ({ cardGroupId: c, product: { nameHe: CARD_TITLE[c] } })) },
    ticketRegistration: {
      findMany: async ({ where }) => {
        if (where.tourEvent) return [{ tourEventId: state.reg.tourEventId }];
        return [state.reg].filter((r) => CAP.includes(r.status) && r.productVariantId != null).map((r) => ({ productVariantId: r.productVariantId }));
      },
      // syncDealRegistration (WON path) locates the deal reg by bookingId+source.
      findFirst: async ({ where }) => {
        if (where.bookingId !== undefined) return state.reg.bookingId === where.bookingId && state.reg.source === where.source ? { ...state.reg } : null;
        return null; // no held/expired adoption row in this scenario
      },
      update: async ({ where, data }) => { if (where.id === state.reg.id) Object.assign(state.reg, data); return { ...state.reg }; },
      updateMany: async ({ data }) => { Object.assign(state.reg, data); return { count: 1 }; },
    },
    productVariant: {
      findMany: async ({ where }) =>
        where.id.in.filter((id) => CATALOG[id]).map((id) => ({
          id,
          productId: CATALOG[id].productId,
          durationHours: CATALOG[id].durationHours,
          activityComponents: CATALOG[id].comps.map((cid) => ({ activityComponentId: cid })),
        })),
    },
    tourEvent: {
      findUnique: async () => ({ ...state.tour }),
      update: async ({ data }) => { Object.assign(state.tour, data); return { ...state.tour }; },
      updateMany: async () => ({ count: 1 }),
    },
    openTourTemplateProduct: {
      findMany: async () => offered.map((o) => ({ isDefault: o.isDefault, productVariantId: o.productVariantId, productVariant: { activityComponents: CATALOG[o.productVariantId].comps.map((cid) => ({ activityComponent: { isWorkshop: IS_WS[cid] } })) } })),
      findFirst: async ({ where }) => (offered.some((o) => o.productVariantId === where.productVariantId) ? { id: 'x' } : null),
    },
    tourEventActivityComponent: {
      findMany: async () => state.components.map((c) => ({ id: c.id, activityComponentId: c.activityComponentId })),
      deleteMany: async ({ where }) => { state.components = state.components.filter((c) => !where.id.in.includes(c.id)); return { count: where.id.in.length }; },
      createMany: async ({ data }) => { for (const d of data) state.components.push({ id: `te_${state.components.length}`, activityComponentId: d.activityComponentId }); return { count: data.length }; },
    },
  };
  return client;
}

// Simulate the PUT /price-lines transaction body: replace lines via lineToData,
// then run the canonical resync — exactly what the endpoint does.
async function saveBuilderAndResync(client, builderLines) {
  await client.quoteLine.deleteMany({ where: { quoteVersionId: 'qv1' } });
  await client.quoteLine.createMany({ data: builderLines.map((ln, i) => ({ ...lineToData(ln, i), quoteVersionId: 'qv1' })) });
  return resyncDealGroupTours(client, 'd1', {});
}

const showsWorkshop = (s) => s.tour.productId === 'p_ws' || s.components.some((c) => IS_WS[c.activityComponentId]);

for (const scenario of [
  { name: 'WON booking', booking: { id: 'bk1', dealId: 'd1', tourEventId: 'slot1', seats: 3, status: 'active', tourEvent: { id: 'slot1', kind: 'group_slot' } }, regStatus: 'confirmed' },
  { name: 'open HELD reservation', booking: null, regStatus: 'held' },
]) {
  test(`${scenario.name}: adding a workshop ticket flips the tour to workshop; removing it reverts to plain`, async () => {
    const c = fake({ regStatus: scenario.regStatus, booking: scenario.booking });

    // 1) Plain-only cards → tour stays plain.
    await saveBuilderAndResync(c, [builderLine({ card: 'c_plain', tt: 't_adult', qty: 3, variant: 'v_plain' })]);
    assert.equal(c.state.tour.productId, 'p_plain', 'plain-only → plain');
    assert.ok(!showsWorkshop(c.state));

    // 2) Add a workshop ticket → dominant variant workshop → tour workshop.
    await saveBuilderAndResync(c, [
      builderLine({ card: 'c_plain', tt: 't_adult', qty: 3, variant: 'v_plain' }),
      builderLine({ card: 'c_ws', tt: 't_adult', qty: 1, variant: 'v_ws' }),
    ]);
    assert.equal(c.state.reg.productVariantId, 'v_ws', 'registration realigned to workshop');
    assert.equal(c.state.tour.productId, 'p_ws', 'workshop ticket → workshop tour');
    assert.ok(showsWorkshop(c.state));
    // breakdown reflects BOTH cards.
    assert.equal(c.state.reg.ticketBreakdown.length, 2);

    // 3) Remove the workshop ticket → back to plain-only → tour reverts to plain.
    await saveBuilderAndResync(c, [builderLine({ card: 'c_plain', tt: 't_adult', qty: 3, variant: 'v_plain' })]);
    assert.equal(c.state.reg.productVariantId, 'v_plain', 'registration reverts to plain');
    assert.equal(c.state.tour.productId, 'p_plain', 'last workshop removed → plain tour');
    assert.ok(!showsWorkshop(c.state));
  });
}

// The exact regression: if lineToData drops productVariantId, the offering can
// never resolve workshop. This proves the persisted line carries it.
test('the persisted group-ticket QuoteLine carries productVariantId (BUG-1 root cause)', async () => {
  const c = fake();
  await saveBuilderAndResync(c, [builderLine({ card: 'c_ws', tt: 't_adult', qty: 2, variant: 'v_ws' })]);
  assert.equal(c.state.lines[0].productVariantId, 'v_ws');
});
