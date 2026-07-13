import test from 'node:test';
import assert from 'node:assert/strict';
import { realignDealRegistrationVariants } from './reconcileProducts.js';

// The Priority-1 root-cause fix: a plain-only tour kept showing workshop because
// its deal REGISTRATIONS carried a stale workshop variant (a pre-fix snapshot),
// so recompute faithfully re-derived workshop. Realigning each deal registration
// to its deal's CANONICAL purchased offering (the Group Ticket Builder cards, or
// deal.productVariantId when there are no group-ticket lines) is what finally
// lets the tour resolve to plain.

// fake supports two worlds:
//   • no `quote` on a deal → resolveDealGroupOffering returns null → realign
//     falls back to deal.productVariantId (legacy single-product path).
//   • `quote` present → group-ticket lines drive the variant + breakdown, which
//     OVERRIDES any stale deal.productVariantId.
function fake({ regs, quotes = {}, variants = {} }) {
  const state = { regs: regs.map((r) => ({ ...r })) };
  return {
    state,
    ticketRegistration: {
      findMany: async () =>
        state.regs
          .filter((r) => ['active', 'held', 'confirmed'].includes(r.status) && r.source === 'deal' && r.dealId)
          .map((r) => ({
            id: r.id,
            productVariantId: r.productVariantId,
            ticketBreakdown: r.ticketBreakdown ?? null,
            dealId: r.dealId,
            deal: { productVariantId: r.dealVariant },
          })),
      update: async ({ where, data }) => {
        const r = state.regs.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      },
    },
    quoteVersion: {
      findFirst: async ({ where }) => {
        const q = quotes[where.dealId];
        return q ? { id: `qv_${where.dealId}` } : null;
      },
    },
    quoteLine: {
      findMany: async ({ where }) => {
        const dealId = String(where.quoteVersionId).replace(/^qv_/, '');
        return (quotes[dealId] || []).map((l) => ({
          sourceCardGroupId: l.cardId,
          productVariantId: l.variantId,
          quantity: l.qty,
          ticketTypeId: l.ticketTypeId || null,
          ticketType: { nameHe: l.ticketLabel || 'כרטיס' },
        }));
      },
    },
    priceRule: {
      findMany: async ({ where }) => {
        const ids = where.cardGroupId.in;
        return ids.map((id) => ({ cardGroupId: id, product: { nameHe: `card:${id}` } }));
      },
    },
    productVariant: {
      findMany: async ({ where }) =>
        where.id.in.map((id) => variants[id] || { id, productId: `p_${id}`, durationHours: 2, activityComponents: [] }),
    },
  };
}

test('a stale WORKSHOP registration variant is corrected to the deal PLAIN variant', async () => {
  const c = fake({ regs: [{ id: 'r1', status: 'active', source: 'deal', dealId: 'd1', productVariantId: 'v_ws', dealVariant: 'v_plain' }] });
  const changed = await realignDealRegistrationVariants(c, 'slot1');
  assert.equal(changed, 1);
  assert.equal(c.state.regs[0].productVariantId, 'v_plain'); // now matches the plain deal
});

test('a registration already matching its deal is left untouched (idempotent)', async () => {
  const c = fake({ regs: [{ id: 'r1', status: 'active', source: 'deal', dealId: 'd1', productVariantId: 'v_plain', dealVariant: 'v_plain' }] });
  assert.equal(await realignDealRegistrationVariants(c, 'slot1'), 0);
});

test('a null deal variant nulls the registration variant (→ plain base at recompute)', async () => {
  const c = fake({ regs: [{ id: 'r1', status: 'active', source: 'deal', dealId: 'd1', productVariantId: 'v_ws', dealVariant: null }] });
  assert.equal(await realignDealRegistrationVariants(c, 'slot1'), 1);
  assert.equal(c.state.regs[0].productVariantId, null);
});

test('a genuinely-workshop deal keeps its workshop registration variant', async () => {
  const c = fake({ regs: [{ id: 'r1', status: 'active', source: 'deal', dealId: 'd1', productVariantId: 'v_ws', dealVariant: 'v_ws' }] });
  assert.equal(await realignDealRegistrationVariants(c, 'slot1'), 0);
});

test('non-deal (e.g. website) registrations are not realigned', async () => {
  const c = fake({ regs: [{ id: 'r1', status: 'active', source: 'woocommerce', dealId: null, productVariantId: 'v_ws', dealVariant: null }] });
  assert.equal(await realignDealRegistrationVariants(c, 'slot1'), 0);
});

// THE core invariant: the offering comes from the CARDS, not deal.productVariantId.
// A plain-only card selection heals a registration whose stale snapshot AND stale
// deal.productVariantId both say workshop.
test('group-ticket cards (plain-only) override a stale workshop deal variant', async () => {
  const c = fake({
    regs: [{ id: 'r1', status: 'active', source: 'deal', dealId: 'd1', productVariantId: 'v_ws', dealVariant: 'v_ws' }],
    quotes: { d1: [{ cardId: 'c_plain', variantId: 'v_plain', qty: 10, ticketTypeId: 't_adult', ticketLabel: 'מבוגר' }] },
    variants: { v_plain: { id: 'v_plain', productId: 'p_plain', durationHours: 2, activityComponents: [] } },
  });
  const changed = await realignDealRegistrationVariants(c, 'slot1');
  assert.equal(changed, 1);
  assert.equal(c.state.regs[0].productVariantId, 'v_plain'); // cards win over the stale deal variant
  assert.deepEqual(c.state.regs[0].ticketBreakdown, [
    { cardGroupId: 'c_plain', cardTitle: 'card:c_plain', ticketTypeId: 't_adult', ticketLabel: 'מבוגר', productVariantId: 'v_plain', quantity: 10 },
  ]);
});

test('re-running the card-driven realign is idempotent (no change second time)', async () => {
  const c = fake({
    regs: [{ id: 'r1', status: 'active', source: 'deal', dealId: 'd1', productVariantId: 'v_ws', dealVariant: 'v_ws' }],
    quotes: { d1: [{ cardId: 'c_plain', variantId: 'v_plain', qty: 10, ticketTypeId: 't_adult', ticketLabel: 'מבוגר' }] },
    variants: { v_plain: { id: 'v_plain', productId: 'p_plain', durationHours: 2, activityComponents: [] } },
  });
  assert.equal(await realignDealRegistrationVariants(c, 'slot1'), 1);
  assert.equal(await realignDealRegistrationVariants(c, 'slot1'), 0);
});
