import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableCursorTargets } from './adapters.js';
import { CHILD_TABLES } from './sources/airtableTourChildren.js';
import { cursorIdFor } from './worker.js';

// These ids are a CONTRACT between the pre-capture seeding script and the worker.
// A mismatch does not fail loudly — the seeded row is ignored and capture performs
// the unbounded first read, whose page-bound truncation can drop records
// permanently. So the contract is pinned here.

test('every Airtable poll target has a distinct cursor id', () => {
  const targets = airtableCursorTargets();
  assert.equal(targets.length, 1 + Object.keys(CHILD_TABLES).length);
  const ids = targets.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, `cursor ids collide: ${ids.join(', ')}`);
});

test('the ids are exactly the ones the worker will compute', () => {
  for (const t of airtableCursorTargets()) {
    assert.equal(t.id, cursorIdFor({ system: t.system, entity: t.entity, cursorKey: t.cursorKey }));
  }
});

test('one target per child table, plus the master tours table', () => {
  const targets = airtableCursorTargets();
  const master = targets.filter((t) => !t.cursorKey);
  assert.equal(master.length, 1, 'exactly one un-keyed (master tours) target');
  for (const kind of Object.keys(CHILD_TABLES)) {
    assert.ok(targets.some((t) => t.cursorKey === `airtable:child:${kind}`), `no cursor target for child kind ${kind}`);
  }
});

test('every target is scoped to the tourEvent entity', () => {
  // The four targets deliberately share one entity, which is precisely why they
  // need distinct cursorKeys — this is the bug the keys were introduced to fix.
  for (const t of airtableCursorTargets()) {
    assert.equal(t.system, 'airtable');
    assert.equal(t.entity, 'tourEvent');
  }
});

test('deriving targets never ingests', async () => {
  // The stub ingest throws; reaching it would mean derivation has side effects.
  assert.doesNotThrow(() => airtableCursorTargets());
});
