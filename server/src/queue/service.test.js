import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQueue } from './service.js';
import { queueItem, QUEUE_STATUS } from './types.js';

// Aggregating four queues into one view has exactly one real risk: misreporting.
// Four status vocabularies flattened into one could easily lie about what is
// actually happening, so normalisation and ordering are pinned here.

// A db stub covering the four source tables.
function stubDb({ comm = [], wa = [], email = [], reports = [] } = {}) {
  return {
    communicationDelivery: { findMany: async () => comm },
    whatsAppScheduledMessage: { findMany: async () => wa },
    scheduledEmail: { findMany: async () => email },
    adminReportConfig: { findMany: async () => [] },
    adminReportDelivery: { findMany: async () => reports },
  };
}

const iso = (s) => new Date(s);

test('the WhatsApp queue merges every WhatsApp source, and excludes email-only ones', async () => {
  const q = await loadQueue({
    channel: 'whatsapp',
    db: stubDb({
      comm: [{
        id: 'c1', channel: 'whatsapp', status: 'scheduled', intendedAt: iso('2026-09-16T10:00:00Z'),
        messageNumber: 7, recipientSnapshot: { name: 'דנה', phone: '+972500000000' },
        message: { publicNumber: 7, audienceType: 'primary_contact' }, event: { id: 'e1', internalName: 'תזכורת' },
      }],
      wa: [{
        id: 'w1', status: 'pending', scheduledAt: iso('2026-09-16T09:00:00Z'),
        content: 'שלום', accountId: 'acc1', attemptCount: 0,
      }],
      email: [{ id: 'e_row', status: 'pending', scheduledAt: iso('2026-09-16T08:00:00Z'), toJson: [] }],
      reports: [{
        id: 'r1', reportNumber: 1, status: 'pending', createdAt: iso('2026-09-16T11:00:00Z'),
        renderedText: 'דיווח', waAccountId: 'acc1',
      }],
    }),
  });

  const sources = q.items.map((i) => i.source);
  assert.ok(sources.includes('communication'));
  assert.ok(sources.includes('wa_scheduled'));
  assert.ok(sources.includes('admin_report'));
  assert.equal(sources.includes('email'), false, 'the email source must not appear in the WhatsApp tab');
});

test('pending is ordered by when the message will ACTUALLY go, not when it was meant to', async () => {
  // A held row's effectiveAt is what the operator is really asking about.
  const q = await loadQueue({
    channel: 'whatsapp',
    db: stubDb({
      wa: [
        {
          id: 'held', status: 'pending',
          scheduledAt: iso('2026-09-16T03:00:00Z'),        // meant to go first…
          effectiveAt: iso('2026-09-16T09:00:00Z'),        // …but held until 09:00
          waitReason: 'מחוץ לחלון השליחה', content: 'a', accountId: 'acc1',
        },
        {
          id: 'soon', status: 'pending',
          scheduledAt: iso('2026-09-16T08:00:00Z'), content: 'b', accountId: 'acc1',
        },
      ],
    }),
  });
  assert.deepEqual(q.items.map((i) => i.sourceId), ['soon', 'held']);
});

test('queue position counts only rows actually queued, per sending account', async () => {
  const q = await loadQueue({
    channel: 'whatsapp',
    db: stubDb({
      wa: [
        { id: 'a1', status: 'pending', scheduledAt: iso('2026-09-16T08:00:00Z'), content: '', accountId: 'accA' },
        { id: 'a2', status: 'pending', scheduledAt: iso('2026-09-16T08:05:00Z'), content: '', accountId: 'accA' },
        { id: 'b1', status: 'pending', scheduledAt: iso('2026-09-16T08:10:00Z'), content: '', accountId: 'accB' },
        // A failed row is not "next in line" for anything.
        { id: 'f1', status: 'failed', scheduledAt: iso('2026-09-16T07:00:00Z'), content: '', accountId: 'accA', failureReason: 'x' },
      ],
    }),
  });
  const byId = Object.fromEntries(q.items.map((i) => [i.sourceId, i]));
  assert.equal(byId.a1.queuePosition, 1);
  assert.equal(byId.a2.queuePosition, 2);
  // Two accounts drain independently — a global position would be meaningless.
  assert.equal(byId.b1.queuePosition, 1);
  assert.equal(byId.f1.queuePosition, undefined);
});

test('every source normalises to the same small status vocabulary', async () => {
  const q = await loadQueue({
    channel: 'whatsapp',
    db: stubDb({
      comm: [
        { id: 'c1', channel: 'whatsapp', status: 'waiting_window', intendedAt: iso('2026-09-16T10:00:00Z'), message: {}, event: {} },
        { id: 'c2', channel: 'whatsapp', status: 'failed_final', intendedAt: iso('2026-09-16T10:00:00Z'), message: {}, event: {} },
      ],
      wa: [{ id: 'w1', status: 'sending', scheduledAt: iso('2026-09-16T10:00:00Z'), content: '' }],
    }),
  });
  const statuses = q.items.map((i) => i.status);
  for (const s of statuses) assert.ok(Object.values(QUEUE_STATUS).includes(s), `${s} is not a normalised status`);
  const byId = Object.fromEntries(q.items.map((i) => [i.sourceId, i]));
  assert.equal(byId.c1.status, 'waiting');
  assert.equal(byId.c2.status, 'failed');
  assert.equal(byId.c2.terminal, true, 'failed_final must be marked terminal, not retryable');
  assert.equal(byId.w1.status, 'sending');
});

test('the raw source status survives normalisation', async () => {
  // The detail panel must be able to show what the owning system actually says.
  const q = await loadQueue({
    channel: 'whatsapp',
    db: stubDb({ comm: [{ id: 'c1', channel: 'whatsapp', status: 'waiting_dependency', intendedAt: iso('2026-09-16T10:00:00Z'), message: {}, event: {} }] }),
  });
  assert.equal(q.items[0].sourceStatus, 'waiting_dependency');
});

test('wait reasons and next-allowed times are surfaced verbatim', async () => {
  const q = await loadQueue({
    channel: 'whatsapp',
    db: stubDb({
      wa: [{
        id: 'w1', status: 'pending', scheduledAt: iso('2026-09-16T03:00:00Z'),
        effectiveAt: iso('2026-09-16T09:00:00Z'),
        waitReason: 'מחוץ לחלון השליחה "שעות משרד"', content: '', accountId: 'a',
      }],
    }),
  });
  assert.equal(q.items[0].waitReasonHe, 'מחוץ לחלון השליחה "שעות משרד"');
  assert.equal(q.counts.held, 1);
});

test('one failing adapter does not blank the screen', async () => {
  const db = stubDb({ wa: [{ id: 'w1', status: 'pending', scheduledAt: iso('2026-09-16T08:00:00Z'), content: '' }] });
  db.communicationDelivery.findMany = async () => { throw new Error('boom'); };
  const q = await loadQueue({ channel: 'whatsapp', db });
  assert.equal(q.items.length, 1, 'the healthy sources still render');
  assert.equal(q.errors.length, 1);
  assert.match(q.errors[0], /communication/);
});

test('queueItem always produces the full shape', () => {
  // A field present for one source and quietly missing for another is exactly
  // how an aggregate view starts lying.
  const item = queueItem({ source: 'x', sourceId: '1', channel: 'whatsapp', status: 'waiting', scheduledAt: null });
  for (const k of ['key', 'recipient', 'sender', 'preview', 'origin', 'statusHe']) {
    assert.ok(k in item, `${k} missing`);
  }
  assert.equal(item.key, 'x:1');
  assert.equal(item.statusHe, 'ממתין');
});
