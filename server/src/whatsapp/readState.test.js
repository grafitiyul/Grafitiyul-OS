import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptKeys, markChatRead, markChatUnread } from './readState.js';

// ── buildReceiptKeys (pure) ────────────────────────────────────────────────
test('buildReceiptKeys: private chat needs no participant', () => {
  const keys = buildReceiptKeys(
    [{ externalMessageId: 'A' }, { externalMessageId: 'B' }],
    false,
  );
  assert.deepEqual(keys, [{ id: 'A' }, { id: 'B' }]);
});

test('buildReceiptKeys: group carries the sender participant from rawPayload', () => {
  const keys = buildReceiptKeys(
    [{ externalMessageId: 'A', rawPayload: { key: { participant: '972501234567@s.whatsapp.net' } } }],
    true,
  );
  assert.deepEqual(keys, [{ id: 'A', participant: '972501234567@s.whatsapp.net' }]);
});

test('buildReceiptKeys: drops rows without an id, and group rows without a participant', () => {
  const keys = buildReceiptKeys(
    [
      { externalMessageId: null, rawPayload: { key: { participant: 'x@s.whatsapp.net' } } },
      { externalMessageId: 'B', rawPayload: { key: {} } }, // group, no participant
    ],
    true,
  );
  assert.deepEqual(keys, []);
});

// ── markChatRead / markChatUnread (injected prisma + bridge) ────────────────
function fakePrisma({ chat, unread = [] }) {
  const calls = { execRaw: [], updateMany: [], findManyArgs: null };
  return {
    calls,
    whatsAppChat: {
      findUnique: async () => chat,
      updateMany: async ({ data }) => {
        calls.updateMany.push(data);
        return { count: 1 };
      },
    },
    whatsAppMessage: {
      findMany: async (args) => {
        calls.findManyArgs = args;
        return unread;
      },
    },
    $executeRawUnsafe: async (sql, ...args) => {
      calls.execRaw.push({ sql, args });
      return 1;
    },
  };
}

test('markChatRead: advances the water-mark and sends WhatsApp read receipts', async () => {
  const prisma = fakePrisma({
    chat: { id: 'c1', accountId: 'main', externalChatId: '972501234567@s.whatsapp.net', type: 'private', lastReadAt: new Date('2026-07-16T09:00:00Z') },
    unread: [{ externalMessageId: 'M1' }, { externalMessageId: 'M2' }],
  });
  const bridgeCalls = [];
  const bridge = async (accountId, path, opts) => {
    bridgeCalls.push({ accountId, path, body: opts.body });
    return { ok: true };
  };

  const out = await markChatRead('c1', { prisma, bridge });

  assert.deepEqual(out, { ok: true, marked: 2 });
  // Water-mark advance ran.
  assert.equal(prisma.calls.execRaw.length, 1);
  // Only unread (newer than the current water-mark) were fetched.
  assert.equal(prisma.calls.findManyArgs.where.timestampFromSource.gt.toISOString(), '2026-07-16T09:00:00.000Z');
  // Correct bridge read action.
  assert.equal(bridgeCalls.length, 1);
  assert.equal(bridgeCalls[0].path, '/mark-read');
  assert.equal(bridgeCalls[0].accountId, 'main');
  assert.equal(bridgeCalls[0].body.jid, '972501234567@s.whatsapp.net');
  assert.deepEqual(bridgeCalls[0].body.keys, [{ id: 'M1' }, { id: 'M2' }]);
});

test('markChatRead: nothing unread → advances but sends no receipt', async () => {
  const prisma = fakePrisma({
    chat: { id: 'c1', accountId: 'main', externalChatId: 'x@s.whatsapp.net', type: 'private', lastReadAt: new Date() },
    unread: [],
  });
  let bridgeCalled = false;
  const bridge = async () => { bridgeCalled = true; };
  const out = await markChatRead('c1', { prisma, bridge });
  assert.deepEqual(out, { ok: true, marked: 0 });
  assert.equal(prisma.calls.execRaw.length, 1); // still advanced
  assert.equal(bridgeCalled, false);
});

test('markChatRead: a bridge failure is SOFT — GOS read state still stands', async () => {
  const prisma = fakePrisma({
    chat: { id: 'c1', accountId: 'main', externalChatId: 'x@s.whatsapp.net', type: 'private', lastReadAt: null },
    unread: [{ externalMessageId: 'M1' }],
  });
  const bridge = async () => { throw new Error('whatsapp_not_connected'); };
  const out = await markChatRead('c1', { prisma, bridge, log: { warn() {} } });
  assert.deepEqual(out, { ok: true, marked: 1 }); // did not throw
  assert.equal(prisma.calls.execRaw.length, 1);
});

test('markChatRead: unknown chat returns not_found without side effects', async () => {
  const prisma = fakePrisma({ chat: null });
  let bridgeCalled = false;
  const out = await markChatRead('nope', { prisma, bridge: async () => { bridgeCalled = true; } });
  assert.deepEqual(out, { ok: false, reason: 'not_found', marked: 0 });
  assert.equal(prisma.calls.execRaw.length, 0);
  assert.equal(bridgeCalled, false);
});

test('markChatUnread: sets the manual display flag only (no water-mark change)', async () => {
  const prisma = fakePrisma({ chat: { id: 'c1' } });
  const out = await markChatUnread('c1', { prisma });
  assert.deepEqual(out, { ok: true });
  assert.equal(prisma.calls.updateMany.length, 1);
  assert.ok(prisma.calls.updateMany[0].manualUnreadAt instanceof Date);
  assert.equal(prisma.calls.execRaw.length, 0); // never touches the count/water-mark
});
