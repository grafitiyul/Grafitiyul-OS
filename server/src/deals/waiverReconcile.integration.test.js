import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWaiverAfterSave } from './registrationCompletion.js';
import { snapshotWaiverFromLines } from './waiver.js';

// Integration coverage for the waiver lifecycle through the ONE canonical
// recompute (reconcileWaiverAfterSave), the same function the PUT /price-lines
// endpoint calls after persisting a builder edit. A stateful fake models the
// QuoteLine store + the deal + the pinned note. The builder is ALWAYS commercial
// (line prices never change); the waiver + valueMinor are recomputed on top.

const PRICE = { adult: 10000, child: 5000 };
const LABEL = { plain: 'סיור', ws: 'סדנה', adult: 'מבוגר', child: 'ילד' };
const gross = (lines) => lines.reduce((n, l) => n + l.quantity * l.unitPriceMinor, 0);

// builder line list → priced-line shape loadGroupTicketLines returns.
function priced(list) {
  return list.map(([card, tt, qty]) => ({ cardGroupId: card, cardTitle: LABEL[card], ticketTypeId: tt, ticketLabel: LABEL[tt], quantity: qty, unitPriceMinor: PRICE[tt] }));
}

function makeFake(initialLines) {
  const s = { deal: { id: 'd1', valueMinor: 0n, noPaymentWaiver: null }, lines: priced(initialLines), timeline: [], seq: 0 };
  const client = {
    _s: s,
    deal: { update: async ({ data }) => { Object.assign(s.deal, data); return s.deal; } },
    quoteVersion: { findFirst: async () => ({ id: 'qv1' }) },
    quoteLine: {
      findMany: async () => s.lines.map((l) => ({ sourceCardGroupId: l.cardGroupId, ticketTypeId: l.ticketTypeId, quantity: l.quantity, unitPriceMinor: BigInt(l.unitPriceMinor), ticketType: { nameHe: l.ticketLabel } })),
    },
    priceRule: { findMany: async ({ where }) => where.cardGroupId.in.map((c) => ({ cardGroupId: c, product: { nameHe: LABEL[c] } })) },
    timelineEntry: {
      findFirst: async ({ where }) => {
        const wantEvent = where?.data?.equals;
        return [...s.timeline].reverse().find((t) => t.subjectId === where.subjectId && (where.kind ? t.kind === where.kind : true) && (where.isPinned !== undefined ? !!t.isPinned === where.isPinned : true) && (wantEvent ? t.data?.event === wantEvent : true)) || null;
      },
      create: async ({ data }) => { const row = { id: `tl${++s.seq}`, ...data }; s.timeline.push(row); return row; },
      update: async ({ where, data }) => { const row = s.timeline.find((t) => t.id === where.id); if (row) Object.assign(row, data); return row || {}; },
    },
  };
  // Simulate register-without-payment: waiver = all current waived, payable 0.
  s.deal.noPaymentWaiver = snapshotWaiverFromLines(s.lines, { reason: 'אישור מנהל', at: '2026-08-03T00:00:00Z' });
  s.deal.valueMinor = 0n;
  return { client, s };
}

// Simulate a builder edit: set the new commercial lines, then run the ONE
// canonical reconcile with the CURRENT stored waiver.
async function edit(client, s, newLines, decision) {
  s.lines = priced(newLines);
  return reconcileWaiverAfterSave(client, { dealId: 'd1', waiver: s.deal.noPaymentWaiver, grossMinor: gross(s.lines), decision });
}

const payable = (s) => Number(s.deal.valueMinor);
const note = (s) => s.timeline.find((t) => t.data?.event === 'no_payment_note');
const waiverEvents = (s) => s.timeline.filter((t) => t.data?.event === 'waiver_updated');

test('1. waived registration + remove participant → remaining stays free, total ₪0', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 1]], undefined); // decrease → no decision
  assert.equal(payable(s), 0);
  assert.match(note(s).body, /כל המשתתפים ללא תשלום/);
});

test('2. waived + add participant → keep free (expand): total ₪0', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'expand');
  assert.equal(payable(s), 0);
  assert.deepEqual(s.deal.noPaymentWaiver.lines, [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 3 }]);
});

test('3. waived + add participant → charge only the addition', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'charge_added');
  assert.equal(payable(s), PRICE.adult); // exactly one adult payable
  assert.match(note(s).body, /לחיוב/);
});

test('4. waived + add participant → cancel the waiver → full commercial pricing', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'cancel');
  assert.equal(payable(s), 3 * PRICE.adult);
  assert.equal(s.deal.noPaymentWaiver, null);
  assert.match(note(s).body, /הפטור מתשלום בוטל/);
});

test('5. mixed PRODUCTS: waived plain+ws, add a ws → charge only the added ws', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2], ['ws', 'child', 1]]);
  await edit(client, s, [['plain', 'adult', 2], ['ws', 'child', 2]], 'charge_added');
  assert.equal(payable(s), PRICE.child); // one extra child payable
});

test('6. mixed TICKET TYPES on one card: waived adults+children, add an adult → charge one adult', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2], ['plain', 'child', 1]]);
  await edit(client, s, [['plain', 'adult', 3], ['plain', 'child', 1]], 'charge_added');
  assert.equal(payable(s), PRICE.adult);
});

test('7. repeated edits converge correctly', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'charge_added'); // 2 waived, 1 payable
  assert.equal(payable(s), PRICE.adult);
  await edit(client, s, [['plain', 'adult', 2]], undefined); // decrease → 0 payable
  assert.equal(payable(s), 0);
  await edit(client, s, [['plain', 'adult', 4]], 'expand'); // expand all → 0 payable, waiver=4
  assert.equal(payable(s), 0);
  assert.equal(s.deal.noPaymentWaiver.lines[0].quantityWaived, 4);
});

test('8. every edit emits a waiver_updated timeline event', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'charge_added');
  await edit(client, s, [['plain', 'adult', 2]], undefined);
  assert.equal(waiverEvents(s).length, 2);
  assert.equal(waiverEvents(s)[0].data.decision, 'charge_added');
  assert.equal(waiverEvents(s)[1].data.decision, 'auto'); // decrease
});

test('9. the pinned note evolves full → partial → cancelled', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'charge_added');
  assert.match(note(s).body, /לחיוב/); // partial
  await edit(client, s, [['plain', 'adult', 3]], 'cancel');
  assert.match(note(s).body, /בוטל/); // cancelled
});

test('10. the pinned note is a SINGLE entry across many edits (no duplicates / no double calc)', async () => {
  const { client, s } = makeFake([['plain', 'adult', 2]]);
  await edit(client, s, [['plain', 'adult', 3]], 'charge_added');
  await edit(client, s, [['plain', 'adult', 2]], undefined);
  await edit(client, s, [['plain', 'adult', 5]], 'expand');
  const notes = s.timeline.filter((t) => t.data?.event === 'no_payment_note');
  assert.equal(notes.length, 1); // updated in place, never duplicated
  assert.equal(notes[0].isPinned, true);
});
