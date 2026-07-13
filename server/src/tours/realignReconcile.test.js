import test from 'node:test';
import assert from 'node:assert/strict';
import { realignDealRegistrationVariants } from './operationalProduct.js';

// The Priority-1 root-cause fix: a plain-only tour kept showing workshop because
// its deal REGISTRATIONS carried a stale workshop variant (a pre-fix snapshot),
// so recompute faithfully re-derived workshop. Realigning each deal registration
// to its deal's actual variant is what finally lets the tour resolve to plain.

function fake({ regs }) {
  const state = { regs: regs.map((r) => ({ ...r })) };
  return {
    state,
    ticketRegistration: {
      findMany: async () =>
        state.regs
          .filter((r) => ['active', 'held', 'confirmed'].includes(r.status) && r.source === 'deal' && r.dealId)
          .map((r) => ({ id: r.id, productVariantId: r.productVariantId, deal: { productVariantId: r.dealVariant } })),
      update: async ({ where, data }) => {
        const r = state.regs.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      },
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
