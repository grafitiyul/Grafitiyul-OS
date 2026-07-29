import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adapterFor, contactAdapter, dateOnly, dealAdapter, hhmm, noteAdapter,
  organizationAdapter, taskAdapter, entityForPipedriveObject, ENTITY_TO_SOURCE_TYPE,
} from './pipedriveMirror.js';
import { DEAL_FIELDS, ORG_FIELDS, PERSON_FIELDS, STAGE_MAP, stageKeyForPipedriveStage } from './pipedriveFields.js';
import { isMirrorWritable } from '../ownership.js';

const wrap = (current) => ({ meta: { action: 'updated', object: 'deal' }, current });

// ── the frozen stage map ─────────────────────────────────────────────────────

test('the stage map matches the APPROVED migration table', () => {
  assert.equal(stageKeyForPipedriveStage(1), 'lead');
  assert.equal(stageKeyForPipedriveStage(6), 'lead');
  assert.equal(stageKeyForPipedriveStage(3), 'contacted');
  assert.equal(stageKeyForPipedriveStage(35), 'quote');
  assert.equal(stageKeyForPipedriveStage(7), 'quote');
  assert.equal(stageKeyForPipedriveStage(20), 'negotiation');
  assert.equal(stageKeyForPipedriveStage(10), 'stage_a88c9186');
  assert.equal(stageKeyForPipedriveStage(12), 'closing');
});

test('the collection pipeline resolves to closing — payment state is not a sales stage', () => {
  for (const id of [13, 14, 15, 16, 23, 31]) assert.equal(stageKeyForPipedriveStage(id), 'closing');
});

test('an unmapped stage yields null and is therefore OMITTED, never nulled', async () => {
  assert.equal(stageKeyForPipedriveStage(24), null);
  assert.equal(stageKeyForPipedriveStage(9999), null);
  const a = dealAdapter({ stageIdForKey: () => 'gos-stage' });
  const n = await a.normalize(wrap({ id: 1, stage_id: 24 }));
  assert.equal('dealStageId' in n.fields, false, 'an unmapped stage must not move the deal');
});

test('a mapped stage IS translated to the live GOS stage id', async () => {
  const a = dealAdapter({ stageIdForKey: (k) => (k === 'closing' ? 'gos-closing' : null) });
  const n = await a.normalize(wrap({ id: 1, stage_id: 12 }));
  assert.equal(n.fields.dealStageId, 'gos-closing');
});

test('every mapped stage key is a non-empty string the mirror may write', () => {
  assert.ok(isMirrorWritable('deal', 'dealStageId'));
  for (const key of new Set(Object.values(STAGE_MAP))) {
    assert.ok(typeof key === 'string' && key.length, `bad stage key ${key}`);
  }
});

// ── operational custom fields ────────────────────────────────────────────────

test('tour date, time and participants map from the REAL custom keys', async () => {
  const a = dealAdapter({});
  const n = await a.normalize(wrap({
    id: 1,
    [DEAL_FIELDS.tourDate]: '2026-08-14',
    [DEAL_FIELDS.tourTime]: '09:30:00',
    [DEAL_FIELDS.participants]: 42,
  }));
  assert.equal(n.fields.tourDate, '2026-08-14');
  assert.equal(n.fields.tourTime, '09:30');
  assert.equal(n.fields.participants, 42);
});

test('a malformed date or time is refused, never coerced', () => {
  assert.equal(dateOnly('not a date'), null);
  assert.equal(dateOnly('2026-08-14T10:00:00Z'), '2026-08-14');
  assert.equal(hhmm('nonsense'), null);
  assert.equal(hhmm('09:05'), '09:05');
  assert.equal(hhmm('9:05'), '09:05');
});

test('marketing travels BESIDE the field set, not through the deal merge', async () => {
  const a = dealAdapter({});
  const n = await a.normalize(wrap({
    id: 1,
    [DEAL_FIELDS.leadSourceList]: '106',
    [DEAL_FIELDS.campaign]: 'FB-AD2',
  }));
  assert.equal(n.marketing.leadSourceKey, '106');
  assert.equal(n.marketing.campaign, 'FB-AD2');
  assert.equal('campaign' in n.fields, false, 'marketing is not a Deal column');
});

test('the owner resolves to a LABEL, never a bare numeric id', async () => {
  const a = dealAdapter({ ownerLabelFor: (id) => (Number(id) === 77 ? 'Elinoy' : null) });
  const n = await a.normalize(wrap({ id: 1, user_id: { id: 77 } }));
  assert.equal(n.fields.ownerUserId, 'Elinoy');
  const unknown = await a.normalize(wrap({ id: 1, user_id: { id: 999 } }));
  assert.equal('ownerUserId' in unknown.fields, false, 'an unresolved owner is omitted');
});

// ── organization ─────────────────────────────────────────────────────────────

test('org type resolves to a LIVE catalogue id, never a raw enum id', async () => {
  const a = organizationAdapter({ orgTypeIdForLabel: (l) => (l === 'עמותות' ? 'ot-1' : null) });
  const n = await a.normalize({ current: { id: 1, name: 'X', [ORG_FIELDS.orgType]: '272' } });
  assert.equal(n.fields.organizationTypeId, 'ot-1');
  const unknown = await a.normalize({ current: { id: 1, name: 'X', [ORG_FIELDS.orgType]: '9999' } });
  assert.equal('organizationTypeId' in unknown.fields, false);
});

test('org tax id maps from the real custom key', async () => {
  const a = organizationAdapter({});
  const n = await a.normalize({ current: { id: 1, name: 'X', [ORG_FIELDS.taxId]: '514123456' } });
  assert.equal(n.fields.taxId, '514123456');
});

// ── contact ──────────────────────────────────────────────────────────────────

test('contact tax id maps; channels travel BESIDE the field set', async () => {
  const a = contactAdapter();
  const n = await a.normalize({
    current: {
      id: 1, name: 'Dor Cohen',
      [PERSON_FIELDS.taxId]: '123456789',
      phone: [{ value: '050-1234567' }, { value: '03-9999999' }],
      email: [{ value: 'a@b.com' }],
    },
  });
  assert.equal(n.fields.taxId, '123456789');
  assert.equal(n.fields.firstNameHe, 'Dor');
  assert.equal(n.fields.lastNameHe, 'Cohen');
  assert.deepEqual(n.channels.phones, ['050-1234567', '03-9999999']);
  assert.deepEqual(n.channels.emails, ['a@b.com']);
  assert.equal('phones' in n.fields, false, 'append-only channels never enter the field merge');
});

// ── activity to task ─────────────────────────────────────────────────────────

test('an activity maps to a Task with a combined due instant', async () => {
  const a = taskAdapter({ taskTypeIdForKey: (k) => (k === 'call' ? 'tt-call' : null) });
  const n = await a.normalize({ current: { id: 5, subject: 'Call back', due_date: '2026-08-01', due_time: '14:30', done: false, type: 'call' } });
  assert.equal(n.fields.title, 'Call back');
  assert.equal(n.fields.dueAt.toISOString(), '2026-08-01T14:30:00.000Z');
  assert.equal(n.fields.status, 'open');
  assert.equal(n.fields.taskTypeId, 'tt-call');
});

test('a done activity is completed; a due date with no time is midnight', async () => {
  const a = taskAdapter({});
  const n = await a.normalize({ current: { id: 5, subject: 'x', due_date: '2026-08-01', done: true, type: 'task' } });
  assert.equal(n.fields.status, 'completed');
  assert.equal(n.fields.dueAt.toISOString(), '2026-08-01T00:00:00.000Z');
});

test('an unmapped activity type omits the task type rather than guessing', async () => {
  const a = taskAdapter({ taskTypeIdForKey: () => null });
  const n = await a.normalize({ current: { id: 5, subject: 'x', type: 'brand_new_type' } });
  assert.equal('taskTypeId' in n.fields, false);
});

// ── note ─────────────────────────────────────────────────────────────────────

test('a note offers NO mergeable fields — imported history is immutable', async () => {
  const a = noteAdapter();
  const n = await a.normalize({ current: { id: 9, content: 'hello', add_time: '2026-07-01 10:00:00' } });
  assert.deepEqual(n.fields, {}, 'nothing to merge means conflict is impossible');
  assert.equal(n.note.body, 'hello');
  assert.equal(a.immutableAppendOnly, true);
});

test('the note adapter can never write', async () => {
  let wrote = false;
  await noteAdapter().applyGos({ any: () => { wrote = true; } }, 'x', { body: 'y' });
  assert.equal(wrote, false);
});

// ── routing ──────────────────────────────────────────────────────────────────

test('every mirrored Pipedrive object routes to an adapter and a crosswalk type', () => {
  for (const [object, entity] of [
    ['deal', 'deal'], ['person', 'contact'], ['organization', 'organization'],
    ['activity', 'task'], ['note', 'note'],
  ]) {
    assert.equal(entityForPipedriveObject(object), entity, `${object} routing`);
    assert.ok(adapterFor(entity, {}), `${entity} has an adapter`);
    assert.ok(ENTITY_TO_SOURCE_TYPE[entity], `${entity} has a crosswalk sourceType`);
  }
});

test('the crosswalk sourceType vocabulary is NOT the entity vocabulary', () => {
  assert.equal(ENTITY_TO_SOURCE_TYPE.contact, 'person');
  assert.equal(ENTITY_TO_SOURCE_TYPE.task, 'activity');
});

test('deletes are detected for every object type', async () => {
  for (const entity of ['deal', 'contact', 'organization', 'task', 'note']) {
    const n = await adapterFor(entity, {}).normalize({ meta: { action: 'deleted' }, current: null });
    assert.equal(n.sourceDeleted, true, `${entity} delete`);
  }
});
