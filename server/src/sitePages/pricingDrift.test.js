import test from 'node:test';
import assert from 'node:assert/strict';

import { computePricingDrift } from './pricingDrift.js';
import { makeSection, makePricingRow, makePricingLine, emptyDocument } from '../../../shared/sitePage.mjs';

// Drift detection between a page's FROZEN pricing lines and the live canonical
// Pricing Cards. Pure logic — the db is a fake exposing only priceRule.findMany,
// shaped like the real include (tiers, ticketPrices, priceList).

const fakeDb = (rules) => ({
  priceRule: {
    async findMany({ where }) {
      return rules.filter((r) => where.cardGroupId.in.includes(r.cardGroupId));
    },
  },
});

const CARD = 'card_agents_1';

const tieredRule = (over = {}) => ({
  id: 'rule_1',
  cardGroupId: CARD,
  productVariantId: 'var_1',
  active: true,
  priceModel: 'tiered_group',
  tiers: [
    { uptoParticipants: 5, totalPriceMinor: 140000n, sortOrder: 0 },
    { uptoParticipants: 10, totalPriceMinor: 165000n, sortOrder: 1 },
  ],
  perAdditionalParticipantMinor: 12000n,
  ticketPrices: [],
  vatMode: 'excluded',
  priceList: { defaultVatMode: 'included' },
  ...over,
});

function docWithRow(rowPatch) {
  const s = makeSection('pricing');
  s.headingHe = 'מחירון';
  const row = { ...makePricingRow(), titleHe: 'סיור וסדנה', cardGroupId: CARD, variantId: 'var_1', ...rowPatch };
  s.rows = [row];
  return { doc: { ...emptyDocument(), sections: [s] }, sectionId: s.id, rowId: row.id };
}

const frozenLines = () => [
  { ...makePricingLine('tier'), upto: 5, amountMinor: 140000 },
  { ...makePricingLine('tier'), upto: 10, amountMinor: 165000 },
  { ...makePricingLine('extra'), amountMinor: 12000 },
];

test('a row matching the live card reports match (custom lines are ignored)', async () => {
  const { doc, rowId } = docWithRow({
    lines: [...frozenLines(), { ...makePricingLine('custom'), labelHe: 'טעימה כשרה', amountMinor: 20000 }],
  });
  const { rows } = await computePricingDrift(doc, fakeDb([tieredRule()]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowId, rowId);
  assert.equal(rows[0].status, 'match');
  assert.equal(rows[0].live.vatMode, 'excluded');
});

test('a card price change is reported as drift, with the live lines attached', async () => {
  const { doc } = docWithRow({ lines: frozenLines() });
  const moved = tieredRule({ perAdditionalParticipantMinor: 15000n });
  const { rows } = await computePricingDrift(doc, fakeDb([moved]));
  assert.equal(rows[0].status, 'drift');
  const extra = rows[0].live.lines.find((l) => l.kind === 'extra');
  assert.equal(extra.amountMinor, 15000);
});

test('a deactivated or deleted card reports missing_card', async () => {
  const { doc } = docWithRow({ lines: frozenLines() });
  assert.equal((await computePricingDrift(doc, fakeDb([]))).rows[0].status, 'missing_card');
  assert.equal(
    (await computePricingDrift(doc, fakeDb([tieredRule({ active: false })]))).rows[0].status,
    'missing_card',
  );
});

test('the exact variant sibling wins over other locations of the same card', async () => {
  const { doc } = docWithRow({ lines: [{ ...makePricingLine('fixed'), amountMinor: 150000 }] });
  const jerusalem = tieredRule({
    id: 'rule_jm', productVariantId: 'var_1', priceModel: 'fixed', fixedPriceMinor: 150000n, tiers: [], perAdditionalParticipantMinor: null,
  });
  const haifa = tieredRule({
    id: 'rule_hf', productVariantId: 'var_2', priceModel: 'fixed', fixedPriceMinor: 999900n, tiers: [], perAdditionalParticipantMinor: null,
  });
  // Order deliberately puts the other location first.
  const { rows } = await computePricingDrift(doc, fakeDb([haifa, jerusalem]));
  assert.equal(rows[0].status, 'match', 'compared against var_1, not the first row returned');
});

test('rows without a card reference are not reported at all', async () => {
  const { doc } = docWithRow({ cardGroupId: '', variantId: '', lines: frozenLines() });
  const { rows } = await computePricingDrift(doc, fakeDb([tieredRule()]));
  assert.equal(rows.length, 0);
});
