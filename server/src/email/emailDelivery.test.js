import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalDeliveryState,
  deliveryFromScheduledEmail,
  deliverySummaryHe,
  queuedToastHe,
  isDelivered,
  DELIVERY_STATES,
} from '../../../shared/emailDelivery.mjs';
import { describeSendFailure } from './scheduledWorker.js';

// The delivery-truth wall. Deals #27099/#27100: the queue row said 'failed'
// while the timeline said "נשלח מייל", the toast promised delivery within a
// minute, and the בקרה card auto-resolved on a newly queued row.

test('the DB vocabulary maps onto exactly the five canonical states', () => {
  assert.deepEqual(DELIVERY_STATES, ['queued', 'sending', 'sent', 'failed', 'cancelled']);
  assert.equal(canonicalDeliveryState('pending'), 'queued');
  assert.equal(canonicalDeliveryState('pending', { claimedAt: new Date() }), 'sending');
  for (const s of ['sent', 'failed', 'cancelled']) {
    assert.equal(canonicalDeliveryState(s), s);
  }
  // An unknown value must never read as success.
  assert.equal(canonicalDeliveryState('weird'), 'queued');
  assert.equal(canonicalDeliveryState(null), 'queued');
});

test('ONLY sent counts as delivered — the whole point', () => {
  assert.equal(isDelivered('sent'), true);
  for (const s of ['queued', 'sending', 'failed', 'cancelled']) {
    assert.equal(isDelivered(s), false, `${s} must not read as delivered`);
  }
});

test('a queued row never claims to have been sent', () => {
  const d = deliveryFromScheduledEmail({ id: 'x', status: 'pending', sentAt: null });
  assert.equal(d.state, 'queued');
  assert.equal(d.delivered, false);
  assert.equal(d.inFlight, true);
  assert.equal(d.terminal, false);
  assert.match(deliverySummaryHe(d), /טרם נשלח/);
  assert.doesNotMatch(queuedToastHe(d).title, /^המייל נשלח/);
});

test('the incident row reports the truth, with its reason', () => {
  const d = deliveryFromScheduledEmail({
    id: 'cmshgf94h0030csajhja17ipr',
    status: 'failed',
    sentAt: null,
    attemptCount: 6,
    failureReason: 'send_failed: Invalid To header',
  });
  assert.equal(d.state, 'failed');
  assert.equal(d.delivered, false);
  assert.equal(d.terminal, true);
  const summary = deliverySummaryHe(d);
  assert.match(summary, /הלקוח לא קיבל/);
  assert.match(summary, /Invalid To header/);
});

test('a window hold is stated as a hold, not as a send', () => {
  const d = deliveryFromScheduledEmail({
    id: 'x', status: 'pending',
    waitReason: 'window', effectiveAt: '2026-08-08T06:00:00.000Z',
  });
  assert.equal(d.state, 'queued');
  assert.match(deliverySummaryHe(d), /מחוץ לחלון השליחה/);
});

test('a connection deferral is visible rather than silent', () => {
  const d = deliveryFromScheduledEmail({ id: 'x', status: 'pending', connectionDeferredCount: 3 });
  assert.equal(d.connectionDeferred, true);
  assert.match(deliverySummaryHe(d), /החיבור ל-Google/);
});

test('a delivered row is the only one that reads as success', () => {
  const d = deliveryFromScheduledEmail({
    id: 'x', status: 'sent', sentAt: '2026-08-07T12:00:00.000Z', gmailMessageId: 'abc',
  });
  assert.equal(d.delivered, true);
  assert.equal(deliverySummaryHe(d), 'המייל נשלח');
  assert.equal(queuedToastHe(d).title, 'המייל נשלח');
});

test('no row at all → null, never an optimistic default', () => {
  assert.equal(deliveryFromScheduledEmail(null), null);
  assert.equal(deliverySummaryHe(null), 'אין מידע על השליחה');
});

// ── truthful failure text ────────────────────────────────────────────────────

test('describeSendFailure surfaces the provider message, not just the code', () => {
  const e = Object.assign(new Error('send_failed'), {
    code: 'send_failed',
    detail: 'Invalid To header',
  });
  const out = describeSendFailure(e);
  assert.match(out, /send_failed/);
  assert.match(out, /Invalid To header/, 'the reason an operator can act on must survive');
});

test('describeSendFailure degrades gracefully and stays bounded', () => {
  assert.equal(describeSendFailure({ code: 'no_connected_account' }), 'no_connected_account');
  assert.equal(describeSendFailure(new Error('boom')), 'boom');
  const long = Object.assign(new Error('x'), { code: 'send_failed', detail: 'y'.repeat(500) });
  assert.ok(describeSendFailure(long).length <= 300);
});
