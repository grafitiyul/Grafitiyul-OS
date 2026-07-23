// Structured pricing description (Part B formatter) — pure, no DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStructure, describeSurcharges } from './pricingDisplay.js';

test('fixed → one row', () => {
  const d = describeStructure({ priceModel: 'fixed', fixedPriceMinor: 190000n });
  assert.deepEqual(d.rows, [{ kind: 'fixed', labelHe: 'מחיר קבוע', amountMinor: 190000 }]);
});

test('per_head → per-participant row (single price)', () => {
  const d = describeStructure({ priceModel: 'per_head', adultPriceMinor: 15000n, childPriceMinor: 15000n });
  assert.deepEqual(d.rows, [{ kind: 'perParticipant', labelHe: 'מחיר למשתתף', amountMinor: 15000 }]);
});

test('tiered → base-up-to-threshold + extra participant (dynamic values)', () => {
  const d = describeStructure({ priceModel: 'tiered', basePriceMinor: 190000n, baseParticipants: 10, perAdditionalParticipantMinor: 12000n });
  assert.deepEqual(d.rows, [
    { kind: 'tier', labelHe: 'עד 10 משתתפים', amountMinor: 190000 },
    { kind: 'perExtra', labelHe: 'כל משתתף נוסף', amountMinor: 12000 },
  ]);
});

test('tiered_group multiple tiers → all tiers in order + extra', () => {
  const d = describeStructure({
    priceModel: 'tiered_group', perAdditionalParticipantMinor: 10000n,
    tiers: [{ uptoParticipants: 12, totalPriceMinor: 150000n, sortOrder: 1 }, { uptoParticipants: 6, totalPriceMinor: 90000n, sortOrder: 0 }],
  });
  assert.deepEqual(d.rows, [
    { kind: 'tier', labelHe: 'עד 6 משתתפים', amountMinor: 90000 },
    { kind: 'tier', labelHe: 'עד 12 משתתפים', amountMinor: 150000 },
    { kind: 'perExtra', labelHe: 'כל משתתף נוסף', amountMinor: 10000 },
  ]);
});

test('tiered_group with no per-additional → tiers only', () => {
  const d = describeStructure({ priceModel: 'tiered_group', tiers: [{ uptoParticipants: 10, totalPriceMinor: 100000n, sortOrder: 0 }] });
  assert.deepEqual(d.rows, [{ kind: 'tier', labelHe: 'עד 10 משתתפים', amountMinor: 100000 }]);
});

test('ticket_types → per-category rows, total unavailable', () => {
  const d = describeStructure(
    { priceModel: 'ticket_types', ticketPrices: [{ ticketTypeId: 'a', priceMinor: 6000n }, { ticketTypeId: 'b', priceMinor: 4000n }] },
    new Map([['a', 'מבוגר'], ['b', 'ילד']]),
  );
  assert.deepEqual(d.rows, [
    { kind: 'ticket', labelHe: 'מבוגר', amountMinor: 6000 },
    { kind: 'ticket', labelHe: 'ילד', amountMinor: 4000 },
  ]);
  assert.equal(d.totalUnavailable, true);
});

test('unknown/unusual model degrades safely (no misleading rows)', () => {
  const d = describeStructure({ priceModel: 'some_future_model' });
  assert.deepEqual(d.rows, []);
  assert.equal(d.degraded, true);
});

test('surcharges from auto add-on lines are per-group with their amounts', () => {
  const rows = describeSurcharges([
    { label: 'תוספת שבת', unitPriceMinor: 25000, quantity: 1 },
    { label: 'תוספת חג', unitPriceMinor: 30000, quantity: 1 },
  ]);
  assert.deepEqual(rows, [
    { kind: 'surcharge', labelHe: 'תוספת שבת', amountMinor: 25000, perGroup: true },
    { kind: 'surcharge', labelHe: 'תוספת חג', amountMinor: 30000, perGroup: true },
  ]);
});
