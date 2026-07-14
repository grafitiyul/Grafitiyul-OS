import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeRacedTourSlots } from './dedupeRacedTourSlots.js';

// Raced duplicate slot dedupe over fakes. Invariants: the OLDEST twin is kept,
// newer empty twins are CANCELLED (never deleted) with Woo(maintenance origin) +
// Calendar marked pending, and a REGISTERED twin is never auto-cancelled.

function makeEnv({ events, regsById = {} }) {
  const updates = [];
  const client = {
    tourEvent: {
      findMany: async () => events,
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return { id: where.id };
      },
    },
    ticketRegistration: { count: async ({ where }) => regsById[where.tourEventId] || 0 },
    tourAssignment: { findMany: async () => [] },
  };
  return { client, updates };
}

const ev = (id, date, time, createdAt) => ({
  id,
  openTourTemplateId: 'tpl1',
  date,
  startTime: time,
  createdAt: new Date(createdAt),
});

test('cancels the NEWER empty twin, keeps the oldest, mirrors marked pending (maintenance)', async () => {
  const env = makeEnv({
    events: [
      ev('T-old', '2026-08-06', '18:00', '2026-07-13T08:15:33Z'),
      ev('T-new', '2026-08-06', '18:00', '2026-07-13T08:16:57Z'),
      ev('T-solo', '2026-08-07', '11:00', '2026-07-13T08:15:33Z'),
    ],
  });
  const r = await dedupeRacedTourSlots(env.client, { log() {}, warn() {} });
  assert.deepEqual(r.cancelled.map((c) => c.id), ['T-new']);
  assert.equal(env.updates.length, 1);
  const u = env.updates[0];
  assert.equal(u.id, 'T-new');
  assert.equal(u.data.status, 'cancelled');
  assert.equal(u.data.wooSyncStatus, 'pending');
  assert.equal(u.data.wooSyncOrigin, 'maintenance');
  assert.equal(u.data.gcalSyncStatus, 'pending');
});

test('a REGISTERED twin is never auto-cancelled — reported instead', async () => {
  const env = makeEnv({
    events: [
      ev('T-old', '2026-08-06', '18:00', '2026-07-13T08:15:33Z'),
      ev('T-new', '2026-08-06', '18:00', '2026-07-13T08:16:57Z'),
    ],
    regsById: { 'T-new': 3 },
  });
  const r = await dedupeRacedTourSlots(env.client, { log() {}, warn() {} });
  assert.equal(r.cancelled.length, 0);
  assert.equal(env.updates.length, 0);
  assert.deepEqual(r.keptRegistered.map((k) => k.id), ['T-new']);
});

test('different times on the same date are NOT duplicates', async () => {
  const env = makeEnv({
    events: [
      ev('T-a', '2026-08-06', '11:00', '2026-07-13T08:15:33Z'),
      ev('T-b', '2026-08-06', '18:00', '2026-07-13T08:16:57Z'),
    ],
  });
  const r = await dedupeRacedTourSlots(env.client, { log() {}, warn() {} });
  assert.equal(r.cancelled.length, 0);
});
