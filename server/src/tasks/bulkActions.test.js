import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkRequest, chunkIds, summarizeResults, BULK_ACTIONS, MAX_BULK_IDS, BULK_CHUNK_SIZE } from './bulkActions.js';

test('vocabulary: transitions (incl. reopen) + field edits, NEVER delete', () => {
  assert.deepEqual(BULK_ACTIONS, [
    'complete', 'cancel', 'reopen', 'assign_owner', 'set_due_date', 'set_due_time', 'set_priority', 'set_type',
  ]);
  assert.ok(!BULK_ACTIONS.includes('delete'), 'hard delete must never exist (decision #2)');
  assert.deepEqual(parseBulkRequest({ action: 'delete', ids: ['a'] }), { ok: false, error: 'invalid_action' });
});

test('transitions carry no patch', () => {
  for (const action of ['complete', 'cancel', 'reopen']) {
    const r = parseBulkRequest({ action, ids: ['a', 'b'] });
    assert.deepEqual(r, { ok: true, action, ids: ['a', 'b'], patch: null });
  }
});

test('ids: required, deduped, trimmed, capped', () => {
  assert.deepEqual(parseBulkRequest({ action: 'complete' }), { ok: false, error: 'ids_required' });
  assert.deepEqual(parseBulkRequest({ action: 'complete', ids: [] }), { ok: false, error: 'ids_required' });
  assert.deepEqual(parseBulkRequest({ action: 'complete', ids: ['', '  '] }), { ok: false, error: 'ids_required' });
  assert.deepEqual(parseBulkRequest({ action: 'complete', ids: ['a', 'a', ' b '] }).ids, ['a', 'b']);
  const over = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `t${i}`);
  assert.deepEqual(parseBulkRequest({ action: 'complete', ids: over }), { ok: false, error: 'too_many_ids' });
});

test('field-edit actions map to the SAME patch shape parseTaskPatch accepts', () => {
  // One validator: the route hands this patch to applyTaskPatch, which
  // re-validates via parseTaskPatch. Keys here must be parseTaskPatch keys.
  assert.deepEqual(parseBulkRequest({ action: 'assign_owner', ids: ['a'], ownerUserId: ' u1 ' }).patch, { ownerUserId: 'u1' });
  assert.deepEqual(parseBulkRequest({ action: 'set_due_date', ids: ['a'], dueDate: '2026-08-01' }).patch, { dueDate: '2026-08-01' });
  assert.deepEqual(parseBulkRequest({ action: 'set_due_time', ids: ['a'], dueTime: '09:30' }).patch, { dueTime: '09:30' });
  assert.deepEqual(parseBulkRequest({ action: 'set_priority', ids: ['a'], priority: 'high' }).patch, { priority: 'high' });
  assert.deepEqual(parseBulkRequest({ action: 'set_type', ids: ['a'], taskTypeId: 't9' }).patch, { taskTypeId: 't9' });
});

test('clearing values: due time and priority may be cleared in bulk', () => {
  assert.deepEqual(parseBulkRequest({ action: 'set_due_time', ids: ['a'] }).patch, { dueTime: null });
  assert.deepEqual(parseBulkRequest({ action: 'set_priority', ids: ['a'], priority: 'none' }).patch, { priority: null });
});

test('missing required payloads are rejected upfront', () => {
  assert.deepEqual(parseBulkRequest({ action: 'assign_owner', ids: ['a'] }), { ok: false, error: 'owner_required' });
  assert.deepEqual(parseBulkRequest({ action: 'set_due_date', ids: ['a'] }), { ok: false, error: 'due_date_required' });
  assert.deepEqual(parseBulkRequest({ action: 'set_type', ids: ['a'] }), { ok: false, error: 'task_type_required' });
});

test('chunkIds slices at BULK_CHUNK_SIZE and loses nothing', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `t${i}`);
  const chunks = chunkIds(ids);
  assert.equal(chunks.length, Math.ceil(60 / BULK_CHUNK_SIZE));
  assert.deepEqual(chunks.flat(), ids);
  assert.ok(chunks.every((c) => c.length <= BULK_CHUNK_SIZE));
  assert.deepEqual(chunkIds([]), []);
});

test('summarizeResults reports partial failure per row, never a blanket success', () => {
  const s = summarizeResults([
    { id: 'a', ok: true },
    { id: 'b', ok: false, error: 'task_not_open' },
    { id: 'c', ok: false, error: 'whatsapp_type_locked' },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.succeeded, 1);
  assert.equal(s.failed, 2);
  assert.equal(s.results[1].error, 'task_not_open');
});
