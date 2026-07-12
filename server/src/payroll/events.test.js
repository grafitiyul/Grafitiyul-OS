import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../db.js';
import {
  PAYROLL_CHANGED_TYPE,
  SSE_HEARTBEAT,
  dispatchPayrollChanged,
  emitPayrollChanged,
  payrollSubscriberCount,
  sseData,
  subscribePayrollEvents,
} from './events.js';

// The payroll real-time bus contract:
//   • admin subscribers receive every event, guides only their own
//   • guide payloads never carry person identifiers
//   • emission is post-commit only (root prisma identity check)
//   • a dead subscriber never breaks delivery to the others
// No DB: the affected-person resolver is injected.

function collect(scope) {
  const received = [];
  const unsubscribe = subscribePayrollEvents({ ...scope, send: (e) => received.push(e) });
  return { received, unsubscribe };
}

const microtask = () => new Promise((r) => setImmediate(r));

test('admin subscriber receives the full event', async () => {
  const admin = collect({ scope: 'admin' });
  try {
    await dispatchPayrollChanged({
      activityId: 'act1',
      entryId: 'e1',
      externalPersonId: 'ext1',
      reason: 'office_approved',
    });
    assert.equal(admin.received.length, 1);
    const e = admin.received[0];
    assert.equal(e.type, PAYROLL_CHANGED_TYPE);
    assert.equal(e.activityId, 'act1');
    assert.equal(e.entryId, 'e1');
    assert.equal(e.externalPersonId, 'ext1');
    assert.equal(e.reason, 'office_approved');
    assert.ok(e.occurredAt);
  } finally {
    admin.unsubscribe();
  }
});

test('guide receives only their own events; another guide is filtered', async () => {
  const mine = collect({ scope: 'guide', externalPersonId: 'ext1' });
  const other = collect({ scope: 'guide', externalPersonId: 'ext2' });
  try {
    await dispatchPayrollChanged({
      activityId: 'act1',
      entryId: 'e1',
      externalPersonId: 'ext1',
      reason: 'office_reply',
    });
    assert.equal(mine.received.length, 1);
    assert.equal(other.received.length, 0);
  } finally {
    mine.unsubscribe();
    other.unsubscribe();
  }
});

test('guide payload is minimal — externalPersonId is stripped from the wire', async () => {
  const guide = collect({ scope: 'guide', externalPersonId: 'ext1' });
  try {
    await dispatchPayrollChanged({
      activityId: 'act1',
      entryId: 'e1',
      externalPersonId: 'ext1',
      reason: 'inquiry_accepted',
    });
    assert.equal(guide.received.length, 1);
    assert.equal('externalPersonId' in guide.received[0], false);
    assert.equal(guide.received[0].entryId, 'e1');
  } finally {
    guide.unsubscribe();
  }
});

test('multi-person events (externalPersonIds) reach every affected guide', async () => {
  const oldGuide = collect({ scope: 'guide', externalPersonId: 'ext-old' });
  const newGuide = collect({ scope: 'guide', externalPersonId: 'ext-new' });
  const bystander = collect({ scope: 'guide', externalPersonId: 'ext-else' });
  try {
    await dispatchPayrollChanged({
      activityId: 'act1',
      entryId: 'e1',
      externalPersonIds: ['ext-old', 'ext-new'],
      reason: 'entry_updated',
    });
    assert.equal(oldGuide.received.length, 1);
    assert.equal(newGuide.received.length, 1);
    assert.equal(bystander.received.length, 0);
  } finally {
    oldGuide.unsubscribe();
    newGuide.unsubscribe();
    bystander.unsubscribe();
  }
});

test('activity-scoped event resolves affected persons lazily via the loader', async () => {
  const guide = collect({ scope: 'guide', externalPersonId: 'ext1' });
  const calls = [];
  try {
    await dispatchPayrollChanged(
      { activityId: 'act9', reason: 'activity_voided' },
      { loadPersons: async (id) => (calls.push(id), ['ext1', 'ext2']) },
    );
    assert.deepEqual(calls, ['act9']);
    assert.equal(guide.received.length, 1);
  } finally {
    guide.unsubscribe();
  }
});

test('no guide subscribers → the person loader is never queried', async () => {
  const admin = collect({ scope: 'admin' });
  const calls = [];
  try {
    await dispatchPayrollChanged(
      { activityId: 'act9', reason: 'activity_voided' },
      { loadPersons: async (id) => (calls.push(id), []) },
    );
    assert.equal(calls.length, 0);
    assert.equal(admin.received.length, 1);
  } finally {
    admin.unsubscribe();
  }
});

test('unsubscribe removes the subscriber and stops delivery', async () => {
  const admin = collect({ scope: 'admin' });
  const before = payrollSubscriberCount();
  admin.unsubscribe();
  assert.equal(payrollSubscriberCount(), before - 1);
  await dispatchPayrollChanged({ entryId: 'e1', externalPersonId: 'x', reason: 'entry_updated' });
  assert.equal(admin.received.length, 0);
});

test('POST-COMMIT GUARD: a non-root client (tx/stub) emits nothing', async () => {
  const admin = collect({ scope: 'admin' });
  try {
    const txLikeClient = { payrollEntry: {} }; // any object that is not the prisma singleton
    emitPayrollChanged(txLikeClient, { entryId: 'e1', externalPersonId: 'x', reason: 'entry_updated' });
    await microtask();
    assert.equal(admin.received.length, 0);
  } finally {
    admin.unsubscribe();
  }
});

test('root prisma client emits asynchronously (fire-and-forget)', async () => {
  const admin = collect({ scope: 'admin' });
  try {
    emitPayrollChanged(prisma, { entryId: 'e1', externalPersonId: 'x', reason: 'guide_approved' });
    assert.equal(admin.received.length, 0); // never synchronous
    await microtask();
    assert.equal(admin.received.length, 1);
    assert.equal(admin.received[0].reason, 'guide_approved');
  } finally {
    admin.unsubscribe();
  }
});

test('missing reason emits nothing', async () => {
  const admin = collect({ scope: 'admin' });
  try {
    await dispatchPayrollChanged({ entryId: 'e1', externalPersonId: 'x' });
    assert.equal(admin.received.length, 0);
  } finally {
    admin.unsubscribe();
  }
});

test('a throwing subscriber never breaks delivery to the others', async () => {
  const dead = subscribePayrollEvents({
    scope: 'admin',
    send: () => {
      throw new Error('socket gone');
    },
  });
  const alive = collect({ scope: 'admin' });
  try {
    await dispatchPayrollChanged({ entryId: 'e1', externalPersonId: 'x', reason: 'entry_voided' });
    assert.equal(alive.received.length, 1);
  } finally {
    dead();
    alive.unsubscribe();
  }
});

test('SSE wire format: data frame + heartbeat comment are valid', () => {
  const frame = sseData({ type: PAYROLL_CHANGED_TYPE, reason: 'entry_updated' });
  assert.match(frame, /^data: \{.*\}\n\n$/);
  assert.deepEqual(JSON.parse(frame.slice('data: '.length)), {
    type: PAYROLL_CHANGED_TYPE,
    reason: 'entry_updated',
  });
  assert.equal(SSE_HEARTBEAT.startsWith(':'), true); // SSE comment line
  assert.equal(SSE_HEARTBEAT.endsWith('\n\n'), true);
});
