import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDealGroupOffering, aggregateBreakdowns } from './groupOffering.js';

// A minimal prisma fake for the quote → cards → variants resolution.
function fake({ version = { id: 'qv1' }, lines = [], rules = [], variants = {} } = {}) {
  return {
    quoteVersion: { findFirst: async () => version },
    quoteLine: { findMany: async () => lines },
    priceRule: { findMany: async ({ where }) => rules.filter((r) => where.cardGroupId.in.includes(r.cardGroupId)) },
    productVariant: { findMany: async ({ where }) => where.id.in.map((id) => variants[id]).filter(Boolean) },
  };
}

// A plain variant has NO workshop component; a workshop variant carries one. The
// dominant (superset) variant is what deriveOperational picks for display.
const V = {
  plain: { id: 'v_plain', productId: 'p_plain', durationHours: 2, activityComponents: [{ activityComponentId: 'tour' }] },
  workshop: {
    id: 'v_ws',
    productId: 'p_ws',
    durationHours: 3,
    activityComponents: [{ activityComponentId: 'tour' }, { activityComponentId: 'workshop' }],
  },
};

test('plain-only cards → plain dominant variant + full breakdown', async () => {
  const c = fake({
    lines: [
      { sourceCardGroupId: 'c_plain', productVariantId: 'v_plain', quantity: 8, ticketTypeId: 't_a', ticketType: { nameHe: 'מבוגר' } },
      { sourceCardGroupId: 'c_plain', productVariantId: 'v_plain', quantity: 4, ticketTypeId: 't_c', ticketType: { nameHe: 'ילד' } },
    ],
    rules: [{ cardGroupId: 'c_plain', product: { nameHe: 'סיור בלבד' } }],
    variants: { v_plain: V.plain },
  });
  const offering = await resolveDealGroupOffering(c, 'd1');
  assert.equal(offering.productVariantId, 'v_plain');
  assert.equal(offering.quantity, 12);
  assert.equal(offering.ticketBreakdown.length, 2);
  assert.equal(offering.ticketBreakdown[0].cardTitle, 'סיור בלבד');
});

test('any workshop card → workshop dominant (superset) variant', async () => {
  const c = fake({
    lines: [
      { sourceCardGroupId: 'c_plain', productVariantId: 'v_plain', quantity: 10, ticketTypeId: 't_a', ticketType: { nameHe: 'מבוגר' } },
      { sourceCardGroupId: 'c_ws', productVariantId: 'v_ws', quantity: 4, ticketTypeId: 't_a', ticketType: { nameHe: 'מבוגר' } },
    ],
    rules: [
      { cardGroupId: 'c_plain', product: { nameHe: 'סיור בלבד' } },
      { cardGroupId: 'c_ws', product: { nameHe: 'סיור + סדנה' } },
    ],
    variants: { v_plain: V.plain, v_ws: V.workshop },
  });
  const offering = await resolveDealGroupOffering(c, 'd1');
  assert.equal(offering.productVariantId, 'v_ws'); // superset covers plain+workshop
});

test('no working quote version → null (caller falls back to deal variant)', async () => {
  assert.equal(await resolveDealGroupOffering(fake({ version: null }), 'd1'), null);
});

test('no group-ticket lines → null', async () => {
  assert.equal(await resolveDealGroupOffering(fake({ lines: [] }), 'd1'), null);
});

test('missing quote surface (incomplete client) → null, no throw', async () => {
  assert.equal(await resolveDealGroupOffering({}, 'd1'), null);
});

test('aggregateBreakdowns: sums per card + per ticket, only existing dimensions', () => {
  const regs = [
    {
      ticketBreakdown: [
        { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 8 },
        { cardGroupId: 'c1', cardTitle: 'סיור בלבד', ticketTypeId: 't_c', ticketLabel: 'ילד', quantity: 4 },
      ],
    },
    { ticketBreakdown: [{ cardGroupId: 'c2', cardTitle: 'סיור + סדנה', ticketTypeId: 't_a', ticketLabel: 'מבוגר', quantity: 4 }] },
  ];
  const agg = aggregateBreakdowns(regs);
  assert.equal(agg.total, 16);
  assert.equal(agg.byCard.length, 2);
  assert.equal(agg.byTicketType.find((t) => t.key === 't_a').quantity, 12);
});

test('aggregateBreakdowns: legacy rows (no breakdown) count quantity, add no dimensions', () => {
  const agg = aggregateBreakdowns([{ quantity: 5, ticketBreakdown: null }]);
  assert.equal(agg.total, 5);
  assert.deepEqual(agg.byCard, []);
  assert.deepEqual(agg.byTicketType, []);
});
