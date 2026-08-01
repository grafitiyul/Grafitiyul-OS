import test from 'node:test';
import assert from 'node:assert/strict';
import { expireTrulyStale } from './scheduledWorker.js';
import { israelLocalToMs } from '../communication/windows.js';

// The non-negotiable: a message held back by a sending window must NEVER be
// deleted. Before this change every pending row older than 2h was flipped to
// 'skipped', so a provider outage overnight silently destroyed the backlog.
//
// The rule now: overdue + window would allow it now  → genuinely stale
//               overdue + window is closed           → keep waiting, say why

const OFFICE_HOURS = {
  id: 'w1', name: 'שעות משרד',
  rules: [{ days: [0, 1, 2, 3, 4], start: '09:00', end: '18:00' }],
};

const at = (t) => israelLocalToMs('2026-09-16', Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]));

function stubDb({ rows = [], windowed = false } = {}) {
  const updates = [];
  return {
    updates,
    rows,
    whatsAppScheduledMessage: {
      findMany: async () => rows,
      updateMany: async ({ where, data }) => {
        updates.push({ id: where.id, data });
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return { count: 1 };
      },
    },
    communicationWindowException: { findMany: async () => [] },
    communicationSendingWindow: { findUnique: async () => OFFICE_HOURS },
    sendingWindowPolicy: {
      findUnique: async () => (windowed
        ? { audienceKind: 'customer', channel: 'whatsapp', enabled: true, window: OFFICE_HOURS }
        : null),
    },
  };
}

const silent = { warn: () => {}, info: () => {}, error: () => {} };

test('a message held by a closed window is KEPT, with its reason and next opening', async () => {
  const db = stubDb({ rows: [{ id: 'm1', personRefId: null }], windowed: true });
  const res = await expireTrulyStale(new Date(at('03:00')), new Date(at('00:00')), silent, { db });

  assert.equal(res.expired, 0, 'nothing may be expired while a window holds it');
  assert.equal(res.held, 1);
  const update = db.updates.find((u) => u.id === 'm1');
  assert.equal(update.data.status, undefined, 'the row must stay pending');
  assert.ok(update.data.waitReason, 'the operator must see why it is waiting');
  assert.equal(update.data.effectiveAt.getTime(), at('09:00'), 'and when it will go');
});

test('a genuinely stale message — no window holding it — is still expired', async () => {
  // The original protection stays intact: without a window, an ancient pending
  // row is a real problem and must not be sent days late.
  const db = stubDb({ rows: [{ id: 'm1', personRefId: null }], windowed: false });
  const res = await expireTrulyStale(new Date(at('03:00')), new Date(at('00:00')), silent, { db });

  assert.equal(res.expired, 1);
  const update = db.updates.find((u) => u.id === 'm1');
  assert.equal(update.data.status, 'skipped');
  assert.ok(update.data.failureReason);
});

test('an overdue message INSIDE the window is expired, not left to rot', async () => {
  // 10:00 is inside office hours, so the window is not what held this back —
  // something else went wrong and the honest answer is still "expired".
  const db = stubDb({ rows: [{ id: 'm1', personRefId: null }], windowed: true });
  const res = await expireTrulyStale(new Date(at('10:00')), new Date(at('06:00')), silent, { db });
  assert.equal(res.expired, 1);
});

test('a whole overnight backlog survives and is scheduled for the same opening', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, personRefId: null }));
  const db = stubDb({ rows, windowed: true });
  const res = await expireTrulyStale(new Date(at('04:30')), new Date(at('00:00')), silent, { db });

  assert.equal(res.expired, 0, 'not one message may be lost');
  assert.equal(res.held, 25);
  for (const u of db.updates) {
    assert.equal(u.data.effectiveAt.getTime(), at('09:00'));
  }
});
