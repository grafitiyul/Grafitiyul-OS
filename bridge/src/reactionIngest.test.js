import test, { before } from 'node:test';
import assert from 'node:assert/strict';

// ingest.js pulls config.js, which fails fast on a missing env var by design —
// so the test provides the two the module graph needs before importing it. It
// never opens a socket or a database: the harness below supplies both.
process.env.DATABASE_URL ||= 'postgresql://test/test';
process.env.WHATSAPP_ACCOUNT_ID ||= 'acc_test';
process.env.BRIDGE_INTERNAL_SECRET ||= 'test-secret';

let createIngest;
before(async () => {
  ({ createIngest } = await import('./ingest.js'));
});

// The reaction contract, locked against the shape Baileys actually emits.
//
// This exists because the original handler read `r.text` and treated the
// TARGET message's key as the reactor. Baileys emits { key, reaction } where
// the emoji lives on `reaction.text` and the reactor on `reaction.key` — so
// every row was written with an EMPTY emoji (which the API drops) and credited
// to the chat's counterparty. Production had zero usable reaction rows: nothing
// had ever rendered.

const ACCOUNT = 'acc_test';
const OWN_JID = '972533083321@s.whatsapp.net';
const CUSTOMER_JID = '972501234567@s.whatsapp.net';

function harness() {
  const rows = new Map(); // "ext|reactor" -> row
  const prisma = {
    whatsAppMessageReaction: {
      async upsert({ where, create, update }) {
        const k = where.accountId_externalMessageId_reactorPhone;
        const id = `${k.externalMessageId}|${k.reactorPhone}`;
        rows.set(id, rows.has(id) ? { ...rows.get(id), ...update } : { ...create });
        return rows.get(id);
      },
      async deleteMany({ where }) {
        rows.delete(`${where.externalMessageId}|${where.reactorPhone}`);
      },
    },
    whatsAppMessage: {
      async findFirst() {
        return { senderName: 'דנה מהקבוצה' };
      },
    },
  };
  const ingest = createIngest({
    prisma,
    socket: { user: { id: OWN_JID, phoneNumber: OWN_JID } },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    accountId: ACCOUNT,
  });
  return { ingest, rows, list: () => [...rows.values()] };
}

// Exactly the payload shape process-message.js emits.
const event = ({ targetId = 'MSG1', text, reactorJid, fromMe = false, participant = null, ms = 1754400000000 }) => ({
  key: { remoteJid: CUSTOMER_JID, id: targetId, fromMe: false },
  reaction: {
    text,
    senderTimestampMs: ms,
    key: { remoteJid: reactorJid, fromMe, id: 'REACT1', ...(participant ? { participant } : {}) },
  },
});

test('a reaction from the customer is stored with its emoji and its reactor', async () => {
  const { ingest, list } = harness();
  await ingest.onReactions([event({ text: '👍', reactorJid: CUSTOMER_JID })]);
  assert.deepEqual(list(), [
    {
      accountId: ACCOUNT,
      externalMessageId: 'MSG1',
      reactorPhone: '972501234567',
      reactorName: 'דנה מהקבוצה',
      emoji: '👍',
      reactedAt: new Date(1754400000000),
    },
  ]);
});

test('OUR OWN reaction is credited to us, not to the person we are talking to', async () => {
  // The bug that made group/private attribution meaningless: the target key's
  // remoteJid is the customer no matter who reacted.
  const { ingest, list } = harness();
  await ingest.onReactions([event({ text: '❤️', reactorJid: CUSTOMER_JID, fromMe: true })]);
  assert.equal(list()[0].reactorPhone, '972533083321');
  assert.equal(list()[0].emoji, '❤️');
});

test('changing a reaction replaces it — one reaction per person, never two rows', async () => {
  const { ingest, list } = harness();
  await ingest.onReactions([event({ text: '👍', reactorJid: CUSTOMER_JID })]);
  await ingest.onReactions([event({ text: '😂', reactorJid: CUSTOMER_JID, ms: 1754400060000 })]);
  assert.equal(list().length, 1);
  assert.equal(list()[0].emoji, '😂');
});

test('removing a reaction (empty emoji) deletes the row rather than leaving a tombstone', async () => {
  const { ingest, list } = harness();
  await ingest.onReactions([event({ text: '👍', reactorJid: CUSTOMER_JID })]);
  await ingest.onReactions([event({ text: '', reactorJid: CUSTOMER_JID })]);
  assert.deepEqual(list(), []);
});

test('two people reacting to the same message are two rows', async () => {
  const { ingest, list } = harness();
  await ingest.onReactions([event({ text: '👍', reactorJid: CUSTOMER_JID })]);
  await ingest.onReactions([event({ text: '👍', reactorJid: CUSTOMER_JID, fromMe: true })]);
  assert.equal(list().length, 2);
  assert.deepEqual(list().map((r) => r.reactorPhone).sort(), ['972501234567', '972533083321']);
});

test('a group reaction is credited to the PARTICIPANT, not to the group', async () => {
  const { ingest, list } = harness();
  await ingest.onReactions([
    event({
      text: '🙏',
      reactorJid: '120363000000000000@g.us',
      participant: '972529998888@s.whatsapp.net',
    }),
  ]);
  assert.equal(list()[0].reactorPhone, '972529998888');
  assert.equal(list()[0].reactorName, 'דנה מהקבוצה', 'the reactor is nameable in a group');
});

test('one malformed reaction never poisons the batch', async () => {
  const { ingest, list } = harness();
  await ingest.onReactions([
    { reaction: { text: '👍' } }, // no target key
    event({ text: '👍', reactorJid: CUSTOMER_JID }),
  ]);
  assert.equal(list().length, 1);
});
