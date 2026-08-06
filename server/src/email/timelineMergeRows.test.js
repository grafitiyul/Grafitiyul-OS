import test from 'node:test';
import assert from 'node:assert/strict';
import { toFeedItem, toScheduledFeedItem } from './timelineMerge.js';

// The Deal/Contact history rows for email. Two sources, one rule that keeps
// them honest AND non-duplicating:
//
//   EmailMessage   — exists because Gmail HAS the message → sent / received
//   ScheduledEmail — a GOS intention, included ONLY while Gmail has not
//                    accepted it (gmailMessageId null) → queued / failed /
//                    cancelled
//
// So a message is represented exactly once, and a queued send can never read
// as sent.

const msg = (over = {}) => ({
  id: 'm1', threadId: 'th1', direction: 'inbound',
  subject: 'שאלה על הסיור', snippet: 'היי, רציתי לברר…',
  fromEmail: 'dana@x.co.il', fromName: 'דנה',
  toRecipients: [{ email: 'info@grafitiyul.co.il', name: 'גרפיטיול' }],
  ccRecipients: [], hasAttachments: false, sentAt: new Date('2026-08-06T09:00:00Z'),
  createdAt: new Date(), createdByUserId: null,
  thread: { linkedDealId: 'd1', contactId: 'c1', messageCount: 3, unreadCount: 0, manualUnread: false },
  _count: { attachments: 0 }, ...over,
});

// ── delivery truth ──────────────────────────────────────────────────────────

test('a mirrored message is sent/received — because Gmail actually has it', () => {
  assert.equal(toFeedItem(msg({ direction: 'inbound' })).data.deliveryState, 'received');
  assert.equal(toFeedItem(msg({ direction: 'outbound' })).data.deliveryState, 'sent');
});

test('queued, failed and cancelled are NEVER reported as sent', () => {
  const s = (status) => toScheduledFeedItem({ id: 's1', status, subject: 'x', toJson: [] }).data.deliveryState;
  assert.equal(s('pending'), 'queued');
  assert.equal(s('sending'), 'queued');
  assert.equal(s('failed'), 'failed');
  assert.equal(s('cancelled'), 'cancelled');
  // An unknown status degrades to the SAFE side — "not yet sent".
  assert.equal(s('something_new'), 'queued');
  for (const st of ['pending', 'sending', 'failed', 'cancelled']) {
    assert.notEqual(s(st), 'sent');
  }
});

test('a failed send carries its reason, so the row can say why', () => {
  const item = toScheduledFeedItem({ id: 's1', status: 'failed', lastError: 'invalid recipient', toJson: [] });
  assert.equal(item.data.failureReason, 'invalid recipient');
  // …and a queued one has no failure to report.
  assert.equal(toScheduledFeedItem({ id: 's2', status: 'pending', toJson: [] }).data.failureReason, null);
});

// ── canonical identity ──────────────────────────────────────────────────────

test('every mirrored row carries the ids the thread modal opens by', () => {
  const d = toFeedItem(msg()).data;
  assert.equal(d.emailMessageId, 'm1');
  assert.equal(d.threadId, 'th1');
});

test('a queued REPLY can still open its thread; a brand-new one honestly cannot', () => {
  assert.equal(toScheduledFeedItem({ id: 's1', status: 'pending', threadId: 'th9', toJson: [] }).data.threadId, 'th9');
  assert.equal(toScheduledFeedItem({ id: 's2', status: 'pending', threadId: null, toJson: [] }).data.threadId, null);
});

test('row ids are namespaced per source, so the two can never collide', () => {
  assert.equal(toFeedItem(msg()).id, 'email:m1');
  assert.equal(toScheduledFeedItem({ id: 'm1', status: 'pending', toJson: [] }).id, 'scheduled-email:m1');
});

// ── what the collapsed row needs ────────────────────────────────────────────

test('attachments report a real COUNT, not just "there are some"', () => {
  assert.equal(toFeedItem(msg({ _count: { attachments: 3 } })).data.attachmentCount, 3);
  assert.equal(toFeedItem(msg()).data.attachmentCount, 0);
});

test('thread size and unread state ride along', () => {
  const d = toFeedItem(msg({
    thread: { linkedDealId: 'd1', messageCount: 7, unreadCount: 2, manualUnread: false },
  })).data;
  assert.equal(d.threadMessageCount, 7);
  assert.equal(d.threadUnread, true);
  // A manual "mark unread" counts as unread even with a zero Gmail count.
  assert.equal(
    toFeedItem(msg({ thread: { messageCount: 1, unreadCount: 0, manualUnread: true } })).data.threadUnread,
    true,
  );
  assert.equal(toFeedItem(msg()).data.threadUnread, false);
});

test('CC rides along so the row can say who else got it', () => {
  const d = toFeedItem(msg({ ccRecipients: [{ email: 'boss@x.co.il' }] })).data;
  assert.equal(d.ccRecipients.length, 1);
});

test('GOS provenance is claimed only where recorded, and only outbound', () => {
  assert.equal(toFeedItem(msg({ direction: 'outbound', createdByUserId: 'u1' })).data.sentFromGos, true);
  // Gmail's SENT label alone cannot tell GOS from someone typing in Gmail.
  assert.equal(toFeedItem(msg({ direction: 'outbound', createdByUserId: null })).data.sentFromGos, false);
  assert.equal(toFeedItem(msg({ direction: 'inbound', createdByUserId: 'u1' })).data.sentFromGos, false);
  // A GOS-composed queued send is GOS by definition.
  assert.equal(toScheduledFeedItem({ id: 's1', status: 'pending', toJson: [] }).data.sentFromGos, true);
});

test('a queued row is ordered by when it is DUE to go out', () => {
  const due = new Date('2026-09-01T07:00:00Z');
  const item = toScheduledFeedItem({ id: 's1', status: 'pending', scheduledAt: due, toJson: [] });
  assert.equal(new Date(item.createdAt).getTime(), due.getTime());
});
