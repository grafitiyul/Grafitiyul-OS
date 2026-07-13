import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotWaiverFromLines,
  computeWaivedMinor,
  computePayableMinor,
  classifyBuilderChange,
  applyWaiverDecision,
  waiverBreakdown,
  describeWaiver,
  describeWaiverCancelled,
} from './waiver.js';

// Priced group lines: card 'plain' has adults @10000, card 'ws' children @5000.
const line = (card, tt, qty, price) => ({ cardGroupId: card, cardTitle: card, ticketTypeId: tt, ticketLabel: tt, quantity: qty, unitPriceMinor: price });

test('snapshotWaiverFromLines waives all current quantities', () => {
  const w = snapshotWaiverFromLines([line('plain', 'adult', 2, 10000), line('ws', 'child', 1, 5000)], { reason: 'VIP', at: '2026-08-03T00:00:00Z' });
  assert.equal(w.reason, 'VIP');
  assert.deepEqual(w.lines, [
    { cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 },
    { cardGroupId: 'ws', ticketTypeId: 'child', quantityWaived: 1 },
  ]);
});

test('computeWaivedMinor clamps to current quantity (a decrease waives less)', () => {
  const w = { lines: [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }] };
  // still 2 present → both waived
  assert.equal(computeWaivedMinor(w, [line('plain', 'adult', 2, 10000)]), 20000);
  // decreased to 1 → only 1 waived (min)
  assert.equal(computeWaivedMinor(w, [line('plain', 'adult', 1, 10000)]), 10000);
});

test('computePayableMinor = gross − waived, clamped ≥ 0', () => {
  const w = { lines: [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }] };
  // 3 adults present, gross 30000, 2 waived → payable 10000
  assert.equal(computePayableMinor(30000, w, [line('plain', 'adult', 3, 10000)]), 10000);
  // all waived → 0
  assert.equal(computePayableMinor(20000, w, [line('plain', 'adult', 2, 10000)]), 0);
});

test('classifyBuilderChange: pure decrease → no decision; increase / new type → decision', () => {
  const old = [line('plain', 'adult', 2, 10000)];
  assert.equal(classifyBuilderChange(old, [line('plain', 'adult', 1, 10000)]).hasIncrease, false); // decrease
  assert.equal(classifyBuilderChange(old, [line('plain', 'adult', 2, 10000)]).hasIncrease, false); // same
  const inc = classifyBuilderChange(old, [line('plain', 'adult', 3, 10000)]);
  assert.equal(inc.hasIncrease, true);
  assert.equal(inc.added[0].addedQty, 1);
  const added = classifyBuilderChange(old, [line('plain', 'adult', 2, 10000), line('ws', 'child', 1, 5000)]);
  assert.equal(added.hasIncrease, true); // a brand-new ticket type
  assert.equal(added.added[0].ticketTypeId, 'child');
});

test('applyWaiverDecision: expand waives everything present; charge_added keeps stored; cancel drops', () => {
  const waiver = { reason: 'x', lines: [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }] };
  const lines = [line('plain', 'adult', 3, 10000)];
  // expand → 3 waived
  assert.deepEqual(applyWaiverDecision(waiver, lines, 'expand').lines, [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 3 }]);
  // charge_added → unchanged (2 waived, 1 payable)
  assert.deepEqual(applyWaiverDecision(waiver, lines, 'charge_added').lines, [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }]);
  // cancel → null
  assert.equal(applyWaiverDecision(waiver, lines, 'cancel'), null);
});

test('applyWaiverDecision prunes waiver lines that no longer exist', () => {
  const waiver = { reason: 'x', lines: [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }, { cardGroupId: 'ws', ticketTypeId: 'child', quantityWaived: 1 }] };
  const lines = [line('plain', 'adult', 2, 10000)]; // ws removed
  const pruned = applyWaiverDecision(waiver, lines, undefined);
  assert.deepEqual(pruned.lines, [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }]);
});

test('describeWaiver: full → "כל המשתתפים"; partial → "לחיוב"; cancelled note', () => {
  const waiver = { reason: 'אישור מנהל', lines: [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }] };
  const full = describeWaiver(waiver, [line('plain', 'adult', 2, 10000)]);
  assert.match(full, /כל המשתתפים ללא תשלום/);
  const partial = describeWaiver(waiver, [line('plain', 'adult', 3, 10000)]);
  assert.match(partial, /לחיוב/);
  assert.match(describeWaiverCancelled('אישור מנהל'), /הפטור מתשלום בוטל/);
});

test('waiverBreakdown reports waived + payable per line', () => {
  const waiver = { lines: [{ cardGroupId: 'plain', ticketTypeId: 'adult', quantityWaived: 2 }] };
  const rows = waiverBreakdown(waiver, [line('plain', 'adult', 3, 10000)]);
  assert.equal(rows[0].waived, 2);
  assert.equal(rows[0].payable, 1);
});
