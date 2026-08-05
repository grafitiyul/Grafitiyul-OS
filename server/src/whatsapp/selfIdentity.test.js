// The self-identity invariant (production #26316): a private chat whose
// remote side is one of OUR OWN connected numbers is internal — never a
// customer. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jidDigits,
  ownAccountPhoneSet,
  resetOwnAccountPhoneCache,
  isInternalRemote,
} from './selfIdentity.js';
import { unlinkInternalWhatsAppChats } from '../maintenance/unlinkInternalWhatsAppChats.js';

const OFFICE = '972533083321';
const MAIN = '972556638970';
const CUSTOMER = '972524346611';

const fakeDb = (chats = []) => ({
  whatsAppAccount: {
    findMany: async () => [
      { phoneJid: `${MAIN}:79@s.whatsapp.net` },
      { phoneJid: `${OFFICE}:57@s.whatsapp.net` },
      { phoneJid: null }, // unpaired account — contributes nothing
    ],
  },
  whatsAppChat: {
    findMany: async () => chats,
    updateMany: async ({ where }) => ({ count: where.id.in.length }),
  },
});

test('jidDigits strips the device suffix and the jid domain', () => {
  assert.equal(jidDigits(`${OFFICE}:57@s.whatsapp.net`), OFFICE);
  assert.equal(jidDigits(`${MAIN}@s.whatsapp.net`), MAIN);
  assert.equal(jidDigits('48056422645963@lid'), '48056422645963');
  assert.equal(jidDigits(null), null);
  assert.equal(jidDigits('not-a-jid'), null);
});

test('ownAccountPhoneSet reads every paired account (device suffixes dropped)', async () => {
  resetOwnAccountPhoneCache();
  const set = await ownAccountPhoneSet({ db: fakeDb(), fresh: true });
  assert.deepEqual([...set].sort(), [OFFICE, MAIN].sort());
});

test('isInternalRemote catches every identity facet — and only real self-numbers', () => {
  const own = new Set([OFFICE, MAIN]);
  // The exact #26316 row: the מכירות↔שירות chat.
  assert.equal(
    isInternalRemote(
      { type: 'private', externalChatId: `${OFFICE}@s.whatsapp.net`, phoneNumber: OFFICE, phoneJid: `${OFFICE}@s.whatsapp.net` },
      own,
    ),
    true,
  );
  // Partially-learned rows still recognized by any single facet.
  assert.equal(isInternalRemote({ type: 'private', phoneNumber: OFFICE }, own), true);
  assert.equal(isInternalRemote({ type: 'private', phoneJid: `${MAIN}:12@s.whatsapp.net` }, own), true);
  // A real customer chat is NOT internal.
  assert.equal(
    isInternalRemote(
      { type: 'private', externalChatId: '48056422645963@lid', phoneNumber: CUSTOMER, phoneJid: `${CUSTOMER}@s.whatsapp.net` },
      own,
    ),
    false,
  );
  // Groups are out of scope; empty set never matches.
  assert.equal(isInternalRemote({ type: 'group', phoneNumber: OFFICE }, own), false);
  assert.equal(isInternalRemote({ type: 'private', phoneNumber: OFFICE }, new Set()), false);
});

test('the boot sweep unlinks ONLY internal linked chats (the #26316 repair)', async () => {
  resetOwnAccountPhoneCache();
  const chats = [
    // The corrupted row: internal chat linked to a customer.
    { id: 'internal1', accountId: 'main', type: 'private', externalChatId: `${OFFICE}@s.whatsapp.net`, phoneNumber: OFFICE, phoneJid: `${OFFICE}@s.whatsapp.net`, lidJid: null, contactId: 'customer1', matchSource: 'phone' },
    // A correctly-linked real customer chat must be untouched.
    { id: 'cust1', accountId: 'office', type: 'private', externalChatId: '48056422645963@lid', phoneNumber: CUSTOMER, phoneJid: `${CUSTOMER}@s.whatsapp.net`, lidJid: '48056422645963@lid', contactId: 'customer1', matchSource: 'phone' },
  ];
  const updates = [];
  const db = fakeDb(chats);
  db.whatsAppChat.updateMany = async ({ where, data }) => {
    updates.push({ ids: where.id.in, data });
    return { count: where.id.in.length };
  };
  const out = await unlinkInternalWhatsAppChats(db, { log: { warn() {}, log() {} } });
  assert.equal(out.repaired, 1);
  assert.deepEqual(updates[0].ids, ['internal1']);
  assert.deepEqual(updates[0].data, { contactId: null, matchSource: null });
});

test('sweep is a no-op when nothing violates the invariant (idempotent)', async () => {
  resetOwnAccountPhoneCache();
  const db = fakeDb([
    { id: 'cust1', accountId: 'office', type: 'private', externalChatId: '48056422645963@lid', phoneNumber: CUSTOMER, phoneJid: null, lidJid: null, contactId: 'customer1', matchSource: 'phone' },
  ]);
  const out = await unlinkInternalWhatsAppChats(db, { log: { warn() {}, log() {} } });
  assert.equal(out.repaired, 0);
});
