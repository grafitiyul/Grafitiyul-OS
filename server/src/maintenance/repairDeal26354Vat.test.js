import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedVatRepair } from './repairDeal26354Vat.js';

// The agreed total for #26354 is ₪300 INCLUDING VAT. The migration stored it as
// ₪300 EXCLUDING VAT, so the Builder read ₪354 against a ₪300 deal. The repair
// moves the order-level mode to 'included' and clears per-line overrides — it
// must never reach the answer by editing the amount or the deal value.

const line = (over = {}) => ({ id: 'l1', quantity: 1, unitPriceMinor: 30_000, vatMode: 'excluded', vatRate: null, ...over });

test('the excluded→included repair lands exactly on the agreed gross', () => {
  const p = plannedVatRepair({
    version: { id: 'v1', vatMode: 'excluded' },
    lines: [line()],
    dealValueMinor: 30_000,
  });
  assert.equal(p.grossBefore, 35_400); // what the Builder wrongly showed
  assert.equal(p.grossAfter, 30_000); // what the customer agreed and paid
  assert.equal(p.valid, true);
  assert.deepEqual(p.lineIds, ['l1']); // the per-line override must be cleared
});

test('a line that already inherits needs no override change', () => {
  const p = plannedVatRepair({
    version: { id: 'v1', vatMode: 'excluded' },
    lines: [line({ vatMode: 'inherit' })],
    dealValueMinor: 30_000,
  });
  assert.deepEqual(p.lineIds, []);
  assert.equal(p.grossAfter, 30_000);
});

test('the repair REFUSES when it would not match the deal value', () => {
  // Safety: this is a targeted repair of a known fact, not a general rewriter.
  // If the arithmetic does not land on the agreed total, nothing is written.
  const p = plannedVatRepair({
    version: { id: 'v1', vatMode: 'excluded' },
    lines: [line({ unitPriceMinor: 25_000 })],
    dealValueMinor: 30_000,
  });
  assert.equal(p.valid, false);
});

test('multiple lines are summed as typed under the included mode', () => {
  const p = plannedVatRepair({
    version: { id: 'v1', vatMode: 'excluded' },
    lines: [line({ id: 'a', unitPriceMinor: 20_000 }), line({ id: 'b', unitPriceMinor: 10_000 })],
    dealValueMinor: 30_000,
  });
  assert.equal(p.grossAfter, 30_000);
  assert.deepEqual(p.lineIds.sort(), ['a', 'b']);
});

test('an exempt line is never inflated by VAT in either mode', () => {
  const p = plannedVatRepair({
    version: { id: 'v1', vatMode: 'excluded' },
    lines: [line({ vatMode: 'exempt' })],
    dealValueMinor: 30_000,
  });
  assert.equal(p.grossBefore, 30_000);
  assert.equal(p.grossAfter, 30_000);
});
