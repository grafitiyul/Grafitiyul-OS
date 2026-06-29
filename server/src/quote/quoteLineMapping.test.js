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
    ...overrides,
  };
}

test('lineToData persists structured identity explicitly', () => {
  const row = lineToData(groupTicketLine(), 0);
  assert.equal(row.sourceKind, 'group_ticket');
  assert.equal(row.sourceCardGroupId, 'cg1');
  assert.equal(row.ticketTypeId, 'tt_adult');
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

test('manual price override flag round-trips', () => {
  const row = lineToData(groupTicketLine({ overridden: true, unitPriceMinor: 15000 }), 0);
  assert.equal(row.overridden, true);
  assert.equal(row.unitPriceMinor, 15000n);
  assert.equal(toClientLine({ ...row, id: 'q' }).overridden, true);
});
