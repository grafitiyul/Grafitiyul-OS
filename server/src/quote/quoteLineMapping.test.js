// QuoteLine mapping tests. Pure — no DB. The point of these tests is the
// STRUCTURED-IDENTITY contract: identity lives in explicit fields, and the user
// `note` is never an identifier (editing/clearing it must not change identity).

import test from 'node:test';
import assert from 'node:assert/strict';
import { lineToData, toClientLine } from './quoteLineMapping.js';

// A Group Ticket line as the client sends it.
function groupTicketLine(overrides = {}) {
  return {
    kind: 'manual',
    label: 'סיור גרפיטי — מבוגר',
    quantity: 3,
    unitPriceMinor: 12000,
    vatMode: 'included',
    vatRate: 18,
    sourceKind: 'group_ticket',
    sourceCardGroupId: 'cg1',
    ticketTypeId: 'tt_adult',
    productVariantId: 'v_ws', // the card's operational variant (workshop)
    ...overrides,
  };
}

test('lineToData persists structured identity explicitly', () => {
  const row = lineToData(groupTicketLine(), 0);
  assert.equal(row.sourceKind, 'group_ticket');
  assert.equal(row.sourceCardGroupId, 'cg1');
  assert.equal(row.ticketTypeId, 'tt_adult');
});

// THE BUG-1 fix: a group-ticket line is kind='manual' (explicit price) yet MUST
// persist its card's productVariantId — the sole input the operational-product
// derivation reads. Without it, a workshop ticket saved a null variant and the
// tour could never derive workshop.
test('lineToData persists productVariantId for a group-ticket (manual) line', () => {
  const row = lineToData(groupTicketLine({ productVariantId: 'v_ws' }), 0);
  assert.equal(row.productVariantId, 'v_ws');
});

test('a plain group-ticket line persists its plain variant', () => {
  const row = lineToData(groupTicketLine({ productVariantId: 'v_plain' }), 0);
  assert.equal(row.productVariantId, 'v_plain');
});

test('a NON-group manual line never gets a fabricated variant', () => {
  const row = lineToData({ kind: 'manual', label: 'שורה', unitPriceMinor: 5000, productVariantId: 'x' }, 0);
  assert.equal(row.productVariantId, null); // only group_ticket lines carry it
});

test('identity is INDEPENDENT of the note — empty/changed note keeps identity', () => {
  const withNote = lineToData(groupTicketLine({ note: 'שיחה עם הלקוח' }), 0);
  const withoutNote = lineToData(groupTicketLine({ note: '' }), 0);
  const changedNote = lineToData(groupTicketLine({ note: 'משהו אחר לגמרי' }), 0);
  // Note round-trips as user content...
  assert.equal(withNote.note, 'שיחה עם הלקוח');
  assert.equal(withoutNote.note, null);
  // ...but identity is the same regardless of the note.
  const id = (r) => [r.sourceKind, r.sourceCardGroupId, r.ticketTypeId];
  assert.deepEqual(id(withNote), ['group_ticket', 'cg1', 'tt_adult']);
  assert.deepEqual(id(withoutNote), ['group_ticket', 'cg1', 'tt_adult']);
  assert.deepEqual(id(changedNote), ['group_ticket', 'cg1', 'tt_adult']);
});

test('round-trip (save → reload) preserves identity for re-hydration', () => {
  const saved = lineToData(groupTicketLine(), 0);
  // Simulate the Prisma row coming back (BigInt money, id assigned).
  const reloaded = toClientLine({ ...saved, id: 'ql1' });
  assert.equal(reloaded.sourceKind, 'group_ticket');
  assert.equal(reloaded.sourceCardGroupId, 'cg1');
  assert.equal(reloaded.ticketTypeId, 'tt_adult');
  assert.equal(reloaded.overridden, false);
});

test('regular (non-group) lines carry NULL identity, never fabricated', () => {
  const row = lineToData({ kind: 'manual', label: 'שורה רגילה', unitPriceMinor: 5000, note: 'הערה' }, 0);
  assert.equal(row.sourceKind, null);
  assert.equal(row.sourceCardGroupId, null);
  assert.equal(row.ticketTypeId, null);
  const back = toClientLine({ ...row, id: 'ql2' });
  assert.equal(back.sourceKind, null);
  assert.equal(back.ticketTypeId, null);
});

// Card first-line note slice: the engine-priced product line carries
// sourceKind='price_rule' + the winning card, and its (possibly multiline
// Hebrew) card note round-trips byte-exact through persistence.
test('price_rule product line: card provenance + multiline Hebrew note round-trip', () => {
  const note = '<p>שורה ראשונה</p><p></p><p>Second line בעברית</p>';
  const row = lineToData(
    {
      kind: 'product',
      label: 'סיור גרפיטי',
      refId: 'v1',
      quantity: 1,
      unitPriceMinor: 118000,
      sourceKind: 'price_rule',
      sourceCardGroupId: 'cardMain',
      note,
    },
    0,
  );
  assert.equal(row.sourceKind, 'price_rule');
  assert.equal(row.sourceCardGroupId, 'cardMain');
  assert.equal(row.productVariantId, 'v1'); // product line variant via refId, unchanged
  assert.equal(row.note, note);
  const back = toClientLine({ ...row, id: 'ql3' });
  assert.equal(back.sourceKind, 'price_rule');
  assert.equal(back.sourceCardGroupId, 'cardMain');
  assert.equal(back.note, note);
});

test('manual price override flag round-trips', () => {
  const row = lineToData(groupTicketLine({ overridden: true, unitPriceMinor: 15000 }), 0);
  assert.equal(row.overridden, true);
  assert.equal(row.unitPriceMinor, 15000n);
  assert.equal(toClientLine({ ...row, id: 'q' }).overridden, true);
});

test('pinnedCardGroupId (manual option selection) round-trips; absent stays null', () => {
  const row = lineToData({ kind: 'product', label: 'x', refId: 'v1', unitPriceMinor: 1000, pinnedCardGroupId: 'card_private' }, 0);
  assert.equal(row.pinnedCardGroupId, 'card_private');
  const back = toClientLine({ ...row, id: 'q1' });
  assert.equal(back.pinnedCardGroupId, 'card_private');
  const none = lineToData({ kind: 'manual', label: 'y', unitPriceMinor: 1 }, 0);
  assert.equal(none.pinnedCardGroupId, null);
});
