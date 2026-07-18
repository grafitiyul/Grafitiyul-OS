import test from 'node:test';
import assert from 'node:assert/strict';
import { mapActivityType, planTaskTypeBackfill, TASK_TYPE_MAP } from './taskTypeMapping.js';

test('mapActivityType: approved labels + raw whatsapp key; unknown → null', () => {
  assert.equal(mapActivityType('פולואפ'), 'follow_up');
  assert.equal(mapActivityType('מעקב לתגובת לקוח להצעת מחיר'), 'follow_up');
  assert.equal(mapActivityType('ליד חדש לשיוך'), 'first_call');
  assert.equal(mapActivityType('לידים רותחים'), 'first_call');
  assert.equal(mapActivityType('שיחה ראשונית'), 'first_call');
  assert.equal(mapActivityType('שיחה ראשונית שלא נענתה'), 'missed_call');
  assert.equal(mapActivityType('גבייה'), 'collection');
  assert.equal(mapActivityType('ווטסאפ'), 'whatsapp');
  assert.equal(mapActivityType('  whatsapp  '), 'whatsapp', 'trims + raw key');
  assert.equal(mapActivityType(null, 'whatsapp'), 'whatsapp', 'matches on raw key fallback');
  assert.equal(mapActivityType('שיחות'), null, 'generic call is deliberately unmapped');
  assert.equal(mapActivityType('meeting'), null);
});

const catalog = new Map([['first_call', 'T1'], ['missed_call', 'T2'], ['collection', 'T3'], ['follow_up', 'T4'], ['whatsapp', 'T5']]);

test('planTaskTypeBackfill: sets type for mapped null-type tasks; already-typed skipped; unmapped demoted', () => {
  const r = planTaskTypeBackfill([
    { taskId: 'a', taskTypeId: null, typeLabel: 'פולואפ' },
    { taskId: 'b', taskTypeId: null, typeLabel: 'ליד חדש לשיוך' },
    { taskId: 'c', taskTypeId: 'EXISTING', typeLabel: 'פולואפ' },     // already typed → never touched
    { taskId: 'd', taskTypeId: null, typeLabel: 'שיחות' },            // unmapped → demote to evidence
    { taskId: 'e', taskTypeId: null, typeLabel: null, rawKey: 'whatsapp' },
  ], catalog);
  assert.equal(r.stats.setType, 3);
  assert.equal(r.stats.alreadyTyped ?? r.skip.alreadyTyped, 1);
  assert.deepEqual(r.setType.find((x) => x.taskId === 'a'), { taskId: 'a', typeKey: 'follow_up', typeId: 'T4' });
  assert.deepEqual(r.setType.find((x) => x.taskId === 'e'), { taskId: 'e', typeKey: 'whatsapp', typeId: 'T5' });
  assert.equal(r.demote.length, 1);
  assert.equal(r.demote[0].taskId, 'd');
  assert.deepEqual(r.stats.byUnmapped, { 'שיחות': 1 });
});

test('planTaskTypeBackfill: a target type missing from the catalog is skipped, never guessed', () => {
  const r = planTaskTypeBackfill([{ taskId: 'a', taskTypeId: null, typeLabel: 'גבייה' }], new Map([['follow_up', 'T4']]));
  assert.equal(r.setType.length, 0);
  assert.equal(r.skip.unknownTarget, 1);
});

test('idempotency: re-running over already-typed tasks plans zero writes', () => {
  const items = [{ taskId: 'a', taskTypeId: 'T4', typeLabel: 'פולואפ' }, { taskId: 'b', taskTypeId: 'T1', typeLabel: 'שיחה ראשונית' }];
  const r = planTaskTypeBackfill(items, catalog);
  assert.equal(r.setType.length, 0);
  assert.equal(r.demote.length, 0);
  assert.equal(r.skip.alreadyTyped, 2);
});

test('the map covers exactly the approved vocabulary', () => {
  assert.deepEqual(new Set(Object.values(TASK_TYPE_MAP)), new Set(['first_call', 'missed_call', 'collection', 'follow_up', 'whatsapp']));
});
