import test from 'node:test';
import assert from 'node:assert/strict';
import { raiseIssue, resolveIssue, resolveMissing } from './issueService.js';

// Minimal prisma stub — records calls, returns scripted rows.
function fakeClient({ existing = null } = {}) {
  const calls = { create: [], update: [], updateMany: [] };
  return {
    calls,
    operationalIssue: {
      findFirst: async () => existing,
      create: async ({ data }) => {
        calls.create.push(data);
        return { id: 'new', ...data };
      },
      update: async ({ where, data }) => {
        calls.update.push({ where, data });
        return { ...existing, ...data };
      },
      updateMany: async ({ where, data }) => {
        calls.updateMany.push({ where, data });
        return { count: 1 };
      },
    },
  };
}

const BASE = {
  type: 'test_issue',
  severity: 'warning',
  sourceModule: 'tours',
  dedupeKey: 'test_issue:x1',
  title: 'כותרת',
  explanation: 'הסבר',
  entityRefs: [{ type: 'tour_event', id: 'x1' }],
  data: { a: 1 },
};

test('raiseIssue creates a new row when no active issue exists for the key', async () => {
  const client = fakeClient();
  const issue = await raiseIssue(client, BASE);
  assert.equal(client.calls.create.length, 1);
  assert.equal(issue.dedupeKey, 'test_issue:x1');
  assert.equal(client.calls.create[0].status, undefined); // default 'open' from schema
});

test('raiseIssue refreshes the existing active row instead of duplicating', async () => {
  const existing = { id: 'i1', status: 'open', dedupeKey: BASE.dedupeKey, data: { a: 0 }, entityRefs: [] };
  const client = fakeClient({ existing });
  await raiseIssue(client, { ...BASE, severity: 'critical' });
  assert.equal(client.calls.create.length, 0);
  assert.equal(client.calls.update.length, 1);
  const { data } = client.calls.update[0];
  assert.equal(data.severity, 'critical');
  assert.ok(data.lastSeenAt instanceof Date);
  // Acknowledged state is preserved — refresh never flips status back to open.
  assert.equal(data.status, undefined);
});

test('resolveIssue targets only active rows and stamps resolution', async () => {
  const client = fakeClient();
  await resolveIssue(client, { dedupeKey: 'k', resolution: 'approve_delete', resolvedBy: 'u1', resolvedByName: 'dor' });
  const { where, data } = client.calls.updateMany[0];
  assert.deepEqual(where.status, { in: ['open', 'acknowledged'] });
  assert.equal(data.status, 'resolved');
  assert.equal(data.resolution, 'approve_delete');
  assert.equal(data.resolvedByName, 'dor');
});

test('resolveIssue without an actor defaults resolution to auto', async () => {
  const client = fakeClient();
  await resolveIssue(client, { id: 'i1' });
  assert.equal(client.calls.updateMany[0].data.resolution, 'auto');
  assert.equal(client.calls.updateMany[0].data.resolvedBy, null);
});

test('resolveMissing auto-resolves active issues whose key disappeared', async () => {
  const client = fakeClient();
  await resolveMissing(client, 'test_issue', new Set(['test_issue:x1']));
  const { where, data } = client.calls.updateMany[0];
  assert.equal(where.type, 'test_issue');
  assert.deepEqual(where.dedupeKey, { notIn: ['test_issue:x1'] });
  assert.equal(data.resolution, 'auto');
});
