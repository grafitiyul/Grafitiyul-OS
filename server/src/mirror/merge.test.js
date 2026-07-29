import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION, mergeField, mergeRecord, reconcileAppendOnly, sameValue } from './merge.js';
import {
  CLASS, MERGE, OWNERSHIP, fieldOwnership, isMirrorWritable, owningSystem,
  postRetirementOwner, writableFields,
} from './ownership.js';

// ── the ownership contract ────────────────────────────────────────────────────

test('an UNDECLARED field is never writable — silence means "not synchronized"', () => {
  assert.equal(fieldOwnership('deal', 'someFieldNobodyDeclared'), null);
  assert.equal(isMirrorWritable('deal', 'someFieldNobodyDeclared'), false);
  assert.equal(fieldOwnership('nosuchentity', 'title'), null);
});

test('identity columns can never be rewritten', () => {
  for (const [entity, field] of [['deal', 'orderNo'], ['contact', 'contactNo'], ['organization', 'orgNo']]) {
    assert.equal(fieldOwnership(entity, field).cls, CLASS.SEEDED);
    assert.equal(isMirrorWritable(entity, field), false);
  }
});

test('GOS-owned deal fields are refused', () => {
  for (const field of ['productId', 'locationId', 'paymentTermId', 'noPaymentWaiver', 'wonQuoteRef', 'notes', 'lostNotes']) {
    assert.equal(isMirrorWritable('deal', field), false, `${field} must not be writable`);
  }
});

test('payroll-suppression and calendar/woo state on tours are protected, including by prefix', () => {
  assert.equal(isMirrorWritable('tourEvent', 'completedReason'), false);
  assert.equal(isMirrorWritable('tourEvent', 'completedAt'), false);
  // Prefix rule: a sync column added later is protected by default, not by memory.
  for (const field of ['gcalEventId', 'gcalSyncStatus', 'gcalSomethingInventedTomorrow', 'wooSyncStatus', 'wooBrandNewColumn']) {
    const o = fieldOwnership('tourEvent', field);
    assert.equal(o.cls, CLASS.GOS, `${field} must be GOS-owned`);
    assert.equal(isMirrorWritable('tourEvent', field), false);
  }
});

test('every entity declares its owning legacy system', () => {
  assert.equal(owningSystem('deal'), 'pipedrive');
  assert.equal(owningSystem('contact'), 'pipedrive');
  assert.equal(owningSystem('tourEvent'), 'airtable');
});

test('post-retirement ownership defaults to GOS; marketing hands over to ingress', () => {
  assert.equal(postRetirementOwner('deal', 'title'), 'gos');
  assert.equal(postRetirementOwner('deal', 'dealSourceId'), 'ingress');
  assert.equal(postRetirementOwner('dealMarketing', 'utmSource'), 'ingress');
});

test('writableFields lists exactly the legacy-owned, writable fields', () => {
  const w = writableFields('deal');
  assert.ok(w.includes('title'));
  assert.ok(w.includes('valueMinor'));
  assert.ok(!w.includes('orderNo'));
  assert.ok(!w.includes('productId'));
  assert.ok(!w.includes('activityType'));
});

test('the tour entity is scoped to crosswalked records only', () => {
  assert.equal(OWNERSHIP.tourEvent.scope, 'crosswalked_only');
});

// ── value equality ────────────────────────────────────────────────────────────

test('dates compare by instant across Date / ISO string / other spellings', () => {
  assert.ok(sameValue(new Date('2026-07-29T10:00:00Z'), '2026-07-29T10:00:00.000Z'));
  assert.ok(sameValue('2026-07-29T10:00:00Z', new Date('2026-07-29T10:00:00Z')));
  assert.ok(!sameValue(new Date('2026-07-29T10:00:00Z'), new Date('2026-07-29T11:00:00Z')));
});

test('money compares across BigInt / string / number', () => {
  assert.ok(sameValue(531000n, '531000'));
  assert.ok(sameValue(531000, 531000n));
  assert.ok(!sameValue(531000n, '531001'));
});

test('null, undefined and empty string are the same absence', () => {
  assert.ok(sameValue(null, undefined));
  assert.ok(sameValue('', null));
  assert.ok(!sameValue('', 'x'));
});

// ── the decision table ────────────────────────────────────────────────────────

const merge3 = (base, source, gos) => mergeField({ entity: 'deal', field: 'title', base, source, gos });

test('source unchanged → NOOP, whatever GOS did', () => {
  assert.equal(merge3('A', 'A', 'A').action, ACTION.NOOP);
  assert.equal(merge3('A', 'A', 'edited in GOS').action, ACTION.NOOP);
});

test('source changed, GOS untouched → MERGE', () => {
  const r = merge3('A', 'B', 'A');
  assert.equal(r.action, ACTION.MERGE);
  assert.equal(r.value, 'B');
});

test('both changed to the SAME value → CONVERGED, no write needed', () => {
  assert.equal(merge3('A', 'B', 'B').action, ACTION.CONVERGED);
});

test('both changed differently → CONFLICT, and nothing is written', () => {
  const r = merge3('A', 'B', 'C');
  assert.equal(r.action, ACTION.CONFLICT);
  assert.equal(r.base, 'A');
  assert.equal(r.source, 'B');
  assert.equal(r.gos, 'C');
  assert.equal(r.value, undefined, 'a conflict must never carry a value to write');
});

test('THE core guarantee: a human edit is never silently overwritten', () => {
  // Operator fixed a typo in GOS; Pipedrive separately changed the title.
  const r = merge3('סיור בתל אביב', 'סיור בתל אביב 2026', 'סיור בתל־אביב');
  assert.equal(r.action, ACTION.CONFLICT);
});

// ── guards ────────────────────────────────────────────────────────────────────

test('gosOwnsCommercials revokes legacy ownership of the money field', () => {
  const args = { entity: 'deal', field: 'valueMinor', base: 100n, source: 200n, gos: 100n };
  assert.equal(mergeField(args).action, ACTION.MERGE, 'normally merges');
  const blocked = mergeField({ ...args, guards: { gosOwnsCommercials: true } });
  assert.equal(blocked.action, ACTION.BLOCKED);
  assert.equal(blocked.reason, 'gosOwnsCommercials');
});

test('a stale Pipedrive value can never overwrite a signed GOS quote', () => {
  const r = mergeField({
    entity: 'deal', field: 'valueMinor',
    base: 500000n, source: 400000n, gos: 500000n,
    guards: { gosOwnsCommercials: true },
  });
  assert.equal(r.action, ACTION.BLOCKED);
  assert.equal(r.value, undefined);
});

// ── special merge strategies ──────────────────────────────────────────────────

test('immutable: settable once, then a difference is a conflict', () => {
  const set = mergeField({ entity: 'dealMarketing', field: 'firstTouchSource', base: null, source: 'פייסבוק', gos: null });
  assert.equal(set.action, ACTION.MERGE);
  const same = mergeField({ entity: 'dealMarketing', field: 'firstTouchSource', base: null, source: 'פייסבוק', gos: 'פייסבוק' });
  assert.equal(same.action, ACTION.NOOP);
  const diff = mergeField({ entity: 'dealMarketing', field: 'firstTouchSource', base: null, source: 'גוגל', gos: 'פייסבוק' });
  assert.equal(diff.action, ACTION.CONFLICT);
});

test('latest-wins overwrites freely and NEVER conflicts', () => {
  const r = mergeField({ entity: 'dealMarketing', field: 'latestTouchSource', base: 'a', source: 'b', gos: 'c' });
  assert.equal(r.action, ACTION.MERGE);
  assert.equal(r.value, 'b');
});

test('latest-wins does not erase a known value with an empty one', () => {
  const r = mergeField({ entity: 'dealMarketing', field: 'campaign', base: 'a', source: null, gos: 'a' });
  assert.equal(r.action, ACTION.NOOP);
});

test('append-only fields are not merged field-wise', () => {
  const r = mergeField({ entity: 'contact', field: 'phones', base: [], source: ['x'], gos: [] });
  assert.equal(r.action, ACTION.SKIPPED);
  assert.equal(r.reason, 'append_only_handled_separately');
});

// ── whole-record merging ──────────────────────────────────────────────────────

test('mergeRecord separates writes, conflicts, baseline advances and refusals', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: { title: 'A', status: 'open', valueMinor: 100n, orderNo: 27000 },
    source: { title: 'B', status: 'won', valueMinor: 300n, orderNo: 99999, notes: 'from pipedrive' },
    gos: { title: 'A', status: 'lost', valueMinor: 200n, orderNo: 27000, notes: 'written in GOS' },
  });
  assert.deepEqual(r.set, { title: 'B' });
  assert.deepEqual(r.conflicts.map((c) => c.field).sort(), ['status', 'valueMinor']);
  assert.deepEqual(Object.keys(r.advance), ['title']);
  assert.deepEqual(r.skipped.map((s) => s.field).sort(), ['notes', 'orderNo']);
  assert.equal(r.hasWork, true);
});

test('CONVERGED advances the baseline without writing — otherwise it re-evaluates forever', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: { title: 'A' }, source: { title: 'B' }, gos: { title: 'B' },
  });
  assert.deepEqual(r.set, {});
  assert.deepEqual(r.advance, { title: 'B' });
  assert.equal(r.hasWork, false);
});

test('a CONFLICT does NOT advance the baseline, so it re-raises until resolved', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: { title: 'A' }, source: { title: 'B' }, gos: { title: 'C' },
  });
  assert.deepEqual(r.advance, {}, 'baseline must not move past an unresolved conflict');
  assert.equal(r.conflicts.length, 1);
});

test('an entirely unchanged record produces no work at all', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: { title: 'A', status: 'open' },
    source: { title: 'A', status: 'open' },
    gos: { title: 'A', status: 'open' },
  });
  assert.equal(r.hasWork, false);
  assert.deepEqual(r.set, {});
  assert.deepEqual(r.conflicts, []);
});

test('the mirror can never write a GOS-owned field even if the source sends one', () => {
  const r = mergeRecord({
    entity: 'tourEvent',
    // A real baseline, so this exercises the merge path rather than bootstrap.
    base: { completedReason: 'migration', gcalEventId: 'evt_real', status: 'draft' },
    source: { completedReason: 'something', gcalEventId: 'evt_1', status: 'scheduled' },
    gos: { completedReason: 'migration', gcalEventId: 'evt_real', status: 'draft' },
  });
  assert.equal(r.set.completedReason, undefined, 'payroll suppression is untouchable');
  assert.equal(r.set.gcalEventId, undefined, 'calendar state is untouchable');
  assert.equal(r.set.status, 'scheduled', 'but a legacy-owned field still merges');
});

// ── first contact ─────────────────────────────────────────────────────────────

test('BOOTSTRAP: a record with no baseline adopts one and writes NOTHING', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: null,
    source: { title: 'B', status: 'won' },
    gos: { title: 'A', status: 'open' },
  });
  assert.equal(r.bootstrapped, true);
  assert.deepEqual(r.set, {}, 'nothing is written on first contact');
  assert.deepEqual(r.conflicts, [], 'and nothing is dressed up as a conflict');
  assert.deepEqual(r.advance, { title: 'B', status: 'won' });
  assert.equal(r.hasWork, false);
});

test('BOOTSTRAP reports pre-existing drift honestly instead of hiding it', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: null,
    source: { title: 'B', status: 'open' },
    gos: { title: 'A', status: 'open' },
  });
  assert.deepEqual(r.drift, [{ field: 'title', source: 'B', gos: 'A' }]);
});

test('BOOTSTRAP never adopts a baseline for a field the mirror may not write', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: null,
    source: { title: 'B', orderNo: 99999, notes: 'x', activityType: 'business' },
    gos: { title: 'A', orderNo: 27000, notes: 'y', activityType: 'private' },
  });
  assert.deepEqual(Object.keys(r.advance), ['title']);
});

test('after bootstrap, the NEXT sync merges normally', () => {
  const boot = mergeRecord({ entity: 'deal', base: null, source: { title: 'B' }, gos: { title: 'A' } });
  // The adopted baseline is now the base for the next round.
  const next = mergeRecord({ entity: 'deal', base: boot.advance, source: { title: 'C' }, gos: { title: 'A' } });
  assert.equal(next.bootstrapped, false);
  // GOS still holds 'A' while the baseline says 'B' — a real human divergence.
  assert.equal(next.conflicts.length, 1);
});

test('an empty-object baseline is NOT bootstrap — it is a genuine empty record', () => {
  const r = mergeRecord({ entity: 'deal', base: {}, source: { title: 'B' }, gos: { title: 'C' } });
  assert.equal(r.bootstrapped, false);
  assert.equal(r.conflicts.length, 1);
});

// ── append-only reconciliation ────────────────────────────────────────────────

const sameDigits = (a, b) => String(a).replace(/\D/g, '').slice(-9) === String(b).replace(/\D/g, '').slice(-9);

test('append-only adds what is missing and NEVER removes or reformats', () => {
  const r = reconcileAppendOnly({
    current: ['050-123-4567', '03-9999999'],
    incoming: ['0501234567', '054-000-0000'],
    isSame: sameDigits,
  });
  assert.deepEqual(r.add, ['054-000-0000'], 'the differently-formatted duplicate is not re-added');
  assert.deepEqual(r.removed, [], 'nothing is ever removed');
});

test('append-only never adds the same new value twice in one pass', () => {
  const r = reconcileAppendOnly({ current: [], incoming: ['050-111-2222', '0501112222'], isSame: sameDigits });
  assert.equal(r.add.length, 1);
});

test('append-only ignores blanks', () => {
  const r = reconcileAppendOnly({ current: [], incoming: ['', null, undefined, '  '], isSame: sameDigits });
  assert.deepEqual(r.add, []);
});

// ── Law compliance, stated as tests ───────────────────────────────────────────

test('LAW: no merge result ever describes a write back to the source', () => {
  const r = mergeRecord({
    entity: 'deal',
    base: { title: 'A' }, source: { title: 'B' }, gos: { title: 'C' },
  });
  const serialized = JSON.stringify(r);
  assert.ok(!/writeToSource|pushTo|updateSource/i.test(serialized));
  // A conflict reports the three values and nothing actionable against legacy.
  assert.deepEqual(Object.keys(r.conflicts[0]).sort(), ['base', 'field', 'gos', 'reason', 'source']);
});

test('LAW: every declared strategy is one the engine actually implements', () => {
  const implemented = new Set(Object.values(MERGE));
  for (const [entity, spec] of Object.entries(OWNERSHIP)) {
    for (const field of spec.fields) {
      assert.ok(implemented.has(field.merge), `${entity}.${field.name} declares unknown strategy ${field.merge}`);
      assert.ok(Object.values(CLASS).includes(field.cls), `${entity}.${field.name} declares unknown class ${field.cls}`);
    }
  }
});
