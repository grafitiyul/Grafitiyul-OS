import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalLineTotalMinor, reconciliationNote } from './historicalPricing.js';

// ── historicalLineTotalMinor ─────────────────────────────────────────────────

test('sums unitPriceMinor × quantity across active lines', () => {
  const lines = [
    { unitPriceMinor: 10000, quantity: 2, active: true }, // 20000
    { unitPriceMinor: 5000, quantity: 3, active: true }, //  15000
  ];
  assert.equal(historicalLineTotalMinor(lines), 35000);
});

test('defaults quantity to 1 when missing or unparseable', () => {
  assert.equal(historicalLineTotalMinor([{ unitPriceMinor: 4200 }]), 4200);
  assert.equal(historicalLineTotalMinor([{ unitPriceMinor: 4200, quantity: '' }]), 4200);
  assert.equal(historicalLineTotalMinor([{ unitPriceMinor: 4200, quantity: 'x' }]), 4200);
});

test('excludes inactive (active:false) lines but keeps undefined-active ones', () => {
  const lines = [
    { unitPriceMinor: 10000, quantity: 1, active: true },
    { unitPriceMinor: 9999, quantity: 1, active: false },
    { unitPriceMinor: 500, quantity: 1 }, // active undefined → included
  ];
  assert.equal(historicalLineTotalMinor(lines), 10500);
});

test('supports negative (discount) lines', () => {
  const lines = [
    { unitPriceMinor: 10000, quantity: 1, active: true },
    { unitPriceMinor: -2500, quantity: 1, active: true },
  ];
  assert.equal(historicalLineTotalMinor(lines), 7500);
});

test('empty / null input is 0', () => {
  assert.equal(historicalLineTotalMinor([]), 0);
  assert.equal(historicalLineTotalMinor(null), 0);
  assert.equal(historicalLineTotalMinor(undefined), 0);
});

// ── reconciliationNote ───────────────────────────────────────────────────────

test('no reconciliation → no note', () => {
  assert.equal(reconciliationNote(null), null);
  assert.equal(reconciliationNote(undefined), null);
});

test('class A → no note', () => {
  assert.equal(reconciliationNote({ class: 'A', dealValueMinor: 10000, lineSumMinor: 10000 }), null);
});

test('class B → zero-value note', () => {
  const note = reconciliationNote({ class: 'B', dealValueMinor: 0, lineSumMinor: 0 });
  assert.ok(note && typeof note.text === 'string');
  assert.match(note.text, /0/);
});

test('class C → shows BOTH amounts and does not imply an error', () => {
  const note = reconciliationNote({ class: 'C', dealValueMinor: 10000, lineSumMinor: 12500 });
  assert.ok(note && typeof note.text === 'string');
  // Both the line sum (125) and the deal value (100) appear.
  assert.match(note.text, /125/);
  assert.match(note.text, /100/);
  assert.doesNotMatch(note.text, /שגיאה|error/i);
});
