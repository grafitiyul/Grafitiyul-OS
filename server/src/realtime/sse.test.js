import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscribe, subscribersOf, subscriberCount, publish, sseData, SSE_HEARTBEAT } from './sse.js';
import { prisma } from '../db.js';
import { emitTasksChanged, TASKS_CHANNEL, TASKS_CHANGED_TYPE } from '../tasks/events.js';

// The shared hub is MECHANISM only (channels, fan-out, plumbing); domain
// policy stays in payroll/events.js (covered by its own suite — the regression
// net for the extraction) and tasks/events.js (covered here).

const drainMicrotasks = () => new Promise((r) => setTimeout(r, 0));

test('channels are isolated — publishing to one never reaches another', () => {
  const got = { a: [], b: [] };
  const offA = subscribe('chan-a', { send: (e) => got.a.push(e) });
  const offB = subscribe('chan-b', { send: (e) => got.b.push(e) });
  publish('chan-a', { n: 1 });
  assert.equal(got.a.length, 1);
  assert.equal(got.b.length, 0);
  offA();
  offB();
});

test('unsubscribe removes exactly one subscriber; counts are per channel', () => {
  const off1 = subscribe('chan-c', { send: () => {} });
  const off2 = subscribe('chan-c', { send: () => {} });
  assert.equal(subscriberCount('chan-c'), 2);
  off1();
  assert.equal(subscriberCount('chan-c'), 1);
  off2();
  assert.equal(subscriberCount('chan-c'), 0);
  assert.equal(subscriberCount('never-used'), 0);
});

test('a dead socket never breaks delivery to the others', () => {
  const got = [];
  const offDead = subscribe('chan-d', { send: () => { throw new Error('socket gone'); } });
  const offLive = subscribe('chan-d', { send: (e) => got.push(e) });
  publish('chan-d', { n: 1 });
  assert.equal(got.length, 1, 'the live subscriber still received the event');
  offDead();
  offLive();
});

test('subscribersOf is a snapshot — safe against mid-iteration mutation', () => {
  const off = subscribe('chan-e', { send: () => {} });
  const snap = subscribersOf('chan-e');
  off();
  assert.equal(snap.length, 1, 'snapshot unaffected by later unsubscribe');
  assert.equal(subscriberCount('chan-e'), 0);
});

test('sse wire format', () => {
  assert.equal(sseData({ a: 1 }), 'data: {"a":1}\n\n');
  assert.equal(SSE_HEARTBEAT, ':hb\n\n');
});

// ── tasks channel policy ────────────────────────────────────────────────────

test('emitTasksChanged: post-commit only — a fake db or tx client is silently skipped', async () => {
  const got = [];
  const off = subscribe(TASKS_CHANNEL, { send: (e) => got.push(e) });
  emitTasksChanged({ notPrisma: true }, { taskId: 't1', dealId: 'd1', reason: 'task_completed' });
  await drainMicrotasks();
  assert.equal(got.length, 0, 'non-root client must never emit (rollback safety)');
  off();
});

test('emitTasksChanged: the root client emits an invalidation HINT to every admin subscriber', async () => {
  const got = [];
  const off = subscribe(TASKS_CHANNEL, { send: (e) => got.push(e) });
  emitTasksChanged(prisma, { taskId: 't1', dealId: 'd1', reason: 'task_completed' });
  await drainMicrotasks();
  assert.equal(got.length, 1);
  assert.equal(got[0].type, TASKS_CHANGED_TYPE);
  assert.equal(got[0].reason, 'task_completed');
  assert.equal(got[0].taskId, 't1');
  // hint only — nothing else rides the wire
  assert.deepEqual(Object.keys(got[0]).sort(), ['dealId', 'occurredAt', 'reason', 'taskId', 'type']);
  off();
});

test('emitTasksChanged: no reason → no event', async () => {
  const got = [];
  const off = subscribe(TASKS_CHANNEL, { send: (e) => got.push(e) });
  emitTasksChanged(prisma, { taskId: 't1', dealId: 'd1' });
  await drainMicrotasks();
  assert.equal(got.length, 0);
  off();
});
