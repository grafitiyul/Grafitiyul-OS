import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_INLINE_WAIT_MS, SEND_GAP_MS, reserveSendSlot, stampManualSend } from './sendPace.js';

// A stand-in for the atomic UPDATE … RETURNING: keeps one next-free stamp per
// account and applies exactly the semantics the SQL does —
//   returned slot = GREATEST(stored, now); stored = that + gap
// so concurrent claims queue instead of collapsing onto the same instant.
function fakeDb({ now = () => 1_000_000, accounts = ['main'] } = {}) {
  const next = new Map();
  const calls = [];
  return {
    calls,
    peek: (id) => next.get(id) ?? null,
    async $queryRawUnsafe(_sql, accountId, gapMs) {
      calls.push({ accountId, gapMs });
      if (!accounts.includes(accountId)) return [];
      const slot = Math.max(next.get(accountId) ?? now(), now());
      next.set(accountId, slot + gapMs);
      return [{ slotAt: new Date(slot).toISOString() }];
    },
  };
}

function recorder() {
  const waits = [];
  return { waits, wait: async (ms) => { waits.push(ms); } };
}

test('the first send of a quiet account does not wait', async () => {
  const db = fakeDb();
  const { wait, waits } = recorder();
  const r = await reserveSendSlot(db, 'main', { now: () => 1_000_000, wait });
  assert.equal(r.waitedMs, 0);
  assert.deepEqual(waits, []);
});

test('a burst of automated sends is spread one gap apart', async () => {
  const now = () => 1_000_000;
  const db = fakeDb({ now });
  const { wait, waits } = recorder();
  for (let i = 0; i < 5; i++) await reserveSendSlot(db, 'main', { now, wait });
  // First goes immediately; each subsequent one waits a further full gap.
  assert.deepEqual(waits, [SEND_GAP_MS, SEND_GAP_MS * 2, SEND_GAP_MS * 3, SEND_GAP_MS * 4]);
});

test('CONCURRENT claims get their own slot — this is the anti-burst guarantee', async () => {
  const now = () => 1_000_000;
  const db = fakeDb({ now });
  const { wait, waits } = recorder();
  // Three different automated senders reaching the pacer at the same instant,
  // which is exactly what three workers on the same 60s tick used to do.
  await Promise.all([
    reserveSendSlot(db, 'main', { now, wait }),
    reserveSendSlot(db, 'main', { now, wait }),
    reserveSendSlot(db, 'main', { now, wait }),
  ]);
  const sorted = [...waits].sort((a, b) => a - b);
  assert.deepEqual(sorted, [SEND_GAP_MS, SEND_GAP_MS * 2]);
  assert.equal(waits.length, 2, 'exactly one of the three sends immediately');
});

test('accounts are paced INDEPENDENTLY — office never waits for main', async () => {
  const now = () => 1_000_000;
  const db = fakeDb({ now, accounts: ['main', 'office'] });
  const { wait, waits } = recorder();
  await reserveSendSlot(db, 'main', { now, wait });
  await reserveSendSlot(db, 'main', { now, wait });
  await reserveSendSlot(db, 'office', { now, wait });
  assert.deepEqual(waits, [SEND_GAP_MS], 'only the second main send waited');
});

test('the clock advances with real time — an idle account is not owed a backlog', async () => {
  let clock = 1_000_000;
  const db = fakeDb({ now: () => clock });
  const { wait, waits } = recorder();
  await reserveSendSlot(db, 'main', { now: () => clock, wait });
  clock += SEND_GAP_MS * 10; // ten quiet gaps go by
  await reserveSendSlot(db, 'main', { now: () => clock, wait });
  assert.deepEqual(waits, [], 'no wait — the slot had long since come free');
});

test('an inline caller past the ceiling sends without parking, and keeps its slot', async () => {
  const now = () => 1_000_000;
  const db = fakeDb({ now });
  const { wait, waits } = recorder();
  // Fill the queue well past the inline ceiling.
  const deep = Math.ceil(MAX_INLINE_WAIT_MS / SEND_GAP_MS) + 2;
  for (let i = 0; i < deep; i++) await reserveSendSlot(db, 'main', { now, wait });
  const before = db.peek('main');
  const r = await reserveSendSlot(db, 'main', { now, wait, maxWaitMs: MAX_INLINE_WAIT_MS });
  assert.equal(r.deferred, true);
  assert.equal(r.waitedMs, 0, 'the request is not held');
  assert.ok(r.wouldHaveWaitedMs > MAX_INLINE_WAIT_MS);
  assert.equal(db.peek('main'), before + SEND_GAP_MS, 'the slot is still consumed — no queue jumping');
});

test('an unknown account is not a reason to refuse a send', async () => {
  const db = fakeDb({ accounts: ['main'] });
  const { wait, waits } = recorder();
  const r = await reserveSendSlot(db, 'ghost', { wait });
  assert.equal(r.skipped, 'unknown_account');
  assert.deepEqual(waits, []);
});

test('no accountId is a no-op rather than a throw', async () => {
  const db = fakeDb();
  const r = await reserveSendSlot(db, null);
  assert.equal(r.skipped, 'no_account');
  assert.equal(db.calls.length, 0);
});

test('a pacing-store failure degrades to a flat gap, never to a burst', async () => {
  const db = { async $queryRawUnsafe() { throw new Error('db down'); } };
  const { wait, waits } = recorder();
  const r = await reserveSendSlot(db, 'main', { wait });
  assert.equal(r.skipped, 'claim_failed');
  assert.deepEqual(waits, [SEND_GAP_MS], 'still spaced, just without a shared clock');
});

test('a manual send never waits but does push the next automated slot out', async () => {
  const now = () => 1_000_000;
  const db = fakeDb({ now });
  const { wait, waits } = recorder();
  await stampManualSend(db, 'main');
  assert.deepEqual(waits, [], 'stamping never sleeps');
  await reserveSendSlot(db, 'main', { now, wait });
  assert.deepEqual(waits, [SEND_GAP_MS], 'the automation queues behind the human');
});

test('a manual send survives a broken pacing store silently', async () => {
  const db = { async $queryRawUnsafe() { throw new Error('db down'); } };
  await stampManualSend(db, 'main'); // must not throw
});
