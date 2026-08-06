import test from 'node:test';
import assert from 'node:assert/strict';
import { lastMessageFacts, toClientThread } from '../routes/email.js';

// The row-level facts a thread LIST needs. A subject and a date cannot answer
// "which way did this go, who is it with, is anything attached, did WE send it"
// — and the Sent view in particular is unreadable without them.

const thread = (over = {}) => ({
  id: 'th1', accountId: 'acc1', subject: 'הצעת מחיר', snippet: 'מצורף…',
  participants: [{ email: 'dana@x.co.il', name: 'דנה' }],
  lastMessageAt: new Date('2026-08-06T09:00:00Z'), messageCount: 3,
  unreadCount: 0, manualUnread: false, inInbox: true, pinnedAt: null,
  contactId: null, matchSource: null, contact: null,
  linkedDealId: null, linkSource: null, linkedDeal: null,
  messages: [], _count: { messages: 0 }, ...over,
});

test('an outbound last message sent through GOS is marked as such', () => {
  const f = lastMessageFacts(thread({
    messages: [{
      direction: 'outbound', fromName: 'גרפיטיול', fromEmail: 'info@grafitiyul.co.il',
      toRecipients: [{ email: 'dana@x.co.il', name: 'דנה' }], createdByUserId: 'user_1',
    }],
  }));
  assert.equal(f.lastDirection, 'outbound');
  assert.deepEqual(f.lastTo, ['דנה']);
  assert.equal(f.sentFromGos, true);
});

test('mail sent from Gmail itself is NOT claimed as GOS', () => {
  // The mailbox is Gmail's truth: an outbound message with no GOS author was
  // typed in Gmail. Claiming it would make the badge a lie.
  const f = lastMessageFacts(thread({
    messages: [{ direction: 'outbound', fromEmail: 'info@grafitiyul.co.il', toRecipients: [], createdByUserId: null }],
  }));
  assert.equal(f.lastDirection, 'outbound');
  assert.equal(f.sentFromGos, false);
});

test('an inbound message can never be GOS-sent, whatever else is on the row', () => {
  const f = lastMessageFacts(thread({
    messages: [{ direction: 'inbound', fromName: 'דנה', fromEmail: 'dana@x.co.il', toRecipients: [], createdByUserId: 'user_1' }],
  }));
  assert.equal(f.sentFromGos, false);
  assert.equal(f.lastFrom, 'דנה');
});

test('a recipient with no name falls back to its address, never to nothing', () => {
  const f = lastMessageFacts(thread({
    messages: [{ direction: 'outbound', toRecipients: [{ email: 'a@b.c' }, { name: 'ג' }, {}], createdByUserId: null }],
  }));
  assert.deepEqual(f.lastTo, ['a@b.c', 'ג']);
});

test('a thread whose messages were not fetched reads as unknown, not as false data', () => {
  assert.deepEqual(lastMessageFacts({}), {
    lastDirection: null, lastFrom: null, lastTo: [], sentFromGos: false,
  });
});

test('the attachment indicator covers the WHOLE conversation', () => {
  assert.equal(toClientThread(thread({ _count: { messages: 0 } })).hasAttachments, false);
  assert.equal(toClientThread(thread({ _count: { messages: 2 } })).hasAttachments, true);
  // A caller that did not ask for the count must not claim there are none…
  // …but it must also not crash. `false` is the safe, non-lying default.
  assert.equal(toClientThread(thread({ _count: undefined })).hasAttachments, false);
});

test('the row carries the deal by its OPERATOR-facing number', () => {
  const c = toClientThread(thread({
    linkedDealId: 'd1',
    linkedDeal: { id: 'd1', orderNo: 26617, title: 'ליד חדש -דור', status: 'open', dealStage: { label: 'תיאום' }, organization: null },
  }));
  assert.equal(c.linkedDeal.orderNo, 26617);
  assert.equal(c.linkedDeal.stageName, 'תיאום');
});

test('toClientThread keeps every field the existing surfaces already read', () => {
  const c = toClientThread(thread());
  for (const k of ['id', 'accountId', 'subject', 'snippet', 'participants', 'lastMessageAt',
    'messageCount', 'unreadCount', 'manualUnread', 'inInbox', 'pinnedAt', 'contactId', 'linkedDealId']) {
    assert.ok(k in c, `${k} must still ship`);
  }
});
