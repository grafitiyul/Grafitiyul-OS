import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorAdapterFactory, airtableChildKindOf } from './adapters.js';
import { MODE, modeOf } from './modes.js';
import { COORD_FIELDS, PAYROLL_FIELDS } from '../migration/import/tourNormalize.js';

// REGRESSION GUARD for a production data-loss bug (2026-07-30).
//
// The factory began `if (system !== 'pipedrive') return null`, so the retry worker
// resolved NO adapter for any Airtable event and marked it `skipped / no_adapter`
// — terminal. With apply off, the apply gate left every polled Airtable change
// pending and the worker destroyed it 60s later. The Phase A buffer lost every
// Airtable change while reporting itself perfectly healthy. Two real coordination
// changes were discarded before it was caught.

test('an Airtable master-tour event resolves an adapter', () => {
  const a = mirrorAdapterFactory('airtable', 'tourEvent', { rawPayload: { id: 'recX', fields: { DATE: '2026-08-01' } } });
  assert.ok(a, 'master tour event must resolve an adapter');
  assert.equal(modeOf(a), MODE.ENTITY_MERGE);
});

test('an Airtable event with NO row still resolves (falls back to the master adapter)', () => {
  // The replay runner may resolve before loading a payload; returning null here is
  // what made events terminal.
  assert.ok(mirrorAdapterFactory('airtable', 'tourEvent', null));
});

// Child adapters need a live Airtable client, which is built from env. Production
// has these set (preflight asserts both); the tests supply them so what is being
// exercised is the RESOLUTION logic, not credential presence.
process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || 'pat_test_only';
process.env.AIRTABLE_MAIN_BASE_ID = process.env.AIRTABLE_MAIN_BASE_ID || 'appTESTBASE';

test('a coordination event resolves the parent_recompute child adapter', () => {
  const row = { rawPayload: { id: 'recC', fields: { [COORD_FIELDS.parentLink]: ['recTOUR'], [COORD_FIELDS.legacyDealId]: 123 } } };
  const a = mirrorAdapterFactory('airtable', 'tourEvent', row);
  assert.ok(a, 'coordination event must resolve an adapter');
  assert.equal(modeOf(a), MODE.PARENT_RECOMPUTE);
  assert.equal(a.childKind, 'coordination');
});

test('a payroll event resolves the payroll child adapter', () => {
  const row = { rawPayload: { id: 'recP', fields: { [PAYROLL_FIELDS.parentLink]: ['recTOUR'] } } };
  const a = mirrorAdapterFactory('airtable', 'tourEvent', row);
  assert.ok(a);
  assert.equal(a.childKind, 'payroll');
});

test('an explicit childKind on the payload wins over field-shape inference', () => {
  assert.equal(airtableChildKindOf({ childKind: 'payroll', fields: { [COORD_FIELDS.parentLink]: ['r'] } }), 'payroll');
});

test('an unknown childKind falls back to inference rather than being trusted', () => {
  assert.equal(airtableChildKindOf({ childKind: 'nonsense', fields: { [COORD_FIELDS.parentLink]: ['r'] } }), 'coordination');
  assert.equal(airtableChildKindOf({ childKind: '__proto__', fields: {} }), null);
});

test('the master table is distinguished by having NEITHER child parent-link', () => {
  assert.equal(airtableChildKindOf({ fields: { DATE: '2026-08-01', 'שם': 'x' } }), null);
  assert.equal(airtableChildKindOf({ fields: {} }), null);
  assert.equal(airtableChildKindOf(null), null);
});

test('the two child link fields are genuinely different — the bug that started this', () => {
  assert.notEqual(COORD_FIELDS.parentLink, PAYROLL_FIELDS.parentLink);
  assert.equal(COORD_FIELDS.parentLink, 'שם סיור');
  assert.equal(PAYROLL_FIELDS.parentLink, 'סיורים');
});

test('a non-tour Airtable entity resolves nothing, and that is deliberate', () => {
  assert.equal(mirrorAdapterFactory('airtable', 'deal', { rawPayload: {} }), null);
});

test('an unknown system still resolves nothing', () => {
  assert.equal(mirrorAdapterFactory('salesforce', 'deal', { rawPayload: {} }), null);
});

test('Pipedrive resolution is unchanged', () => {
  const a = mirrorAdapterFactory('pipedrive', 'deal');
  assert.ok(a);
  assert.equal(modeOf(a), MODE.ENTITY_MERGE);
});
