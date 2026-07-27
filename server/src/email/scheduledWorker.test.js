import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = 'y';
process.env.EMAIL_TOKEN_KEY = 'test-key-for-unit-tests-only-0123456789';
process.env.PUBLIC_ORIGIN = 'https://app.example';

const { deliverScheduledEmail } = await import('./scheduledWorker.js');

// In-memory ScheduledEmail table with just the operations the worker uses.
function fakeDb(rows = []) {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    table,
    scheduledEmail: {
      update: async ({ where, data }) => {
        const row = table.get(where.id);
        const next = { ...row };
        for (const [k, v] of Object.entries(data)) {
          next[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] || 0) + v.increment : v;
        }
        table.set(where.id, next);
        return next;
      },
    },
  };
}

const baseRow = (o = {}) => ({
  id: 's1',
  accountId: 'acc1',
  toJson: [{ email: 'dor@example.com', name: null }],
  ccJson: [],
  bccJson: [],
  subject: 'נושא',
  bodyHtml: '<p>שלום</p>',
  bodyText: 'שלום',
  attachments: null,
  status: 'pending',
  attemptCount: 0,
  connectionDeferredCount: 0,
  gmailMessageId: null,
  ...o,
});

test('successful delivery marks the row sent and records the Gmail id', async () => {
  const db = fakeDb([baseRow()]);
  const sent = [];
  const outcome = await deliverScheduledEmail(db, baseRow(), {
    send: async (p) => {
      sent.push(p);
      return { gmailMessageId: 'g1', threadId: 't1' };
    },
  });
  assert.equal(outcome, 'sent');
  const row = db.table.get('s1');
  assert.equal(row.status, 'sent');
  assert.equal(row.gmailMessageId, 'g1');
  assert.ok(row.sentAt instanceof Date);
  assert.equal(row.claimedAt, null); // claim released
  // The frozen composition is replayed verbatim through the canonical path.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].accountId, 'acc1'); // the account chosen at scheduling time
  assert.equal(sent[0].bodyHtml, '<p>שלום</p>');
  assert.deepEqual(sent[0].to, [{ email: 'dor@example.com', name: null }]);
});

test('IDEMPOTENCY: a row that already has a gmailMessageId is never sent again', async () => {
  const row = baseRow({ gmailMessageId: 'already-sent' });
  const db = fakeDb([row]);
  let calls = 0;
  const outcome = await deliverScheduledEmail(db, row, {
    send: async () => {
      calls += 1;
      return { gmailMessageId: 'DUPLICATE', threadId: null };
    },
  });
  assert.equal(outcome, 'already_sent');
  assert.equal(calls, 0, 'must not call the send path a second time');
  assert.equal(db.table.get('s1').status, 'sent');
  assert.equal(db.table.get('s1').gmailMessageId, 'already-sent'); // not overwritten
});

test('an unhealthy Google connection PRESERVES the item and burns no attempt', async () => {
  const row = baseRow();
  const db = fakeDb([row]);
  const outcome = await deliverScheduledEmail(db, row, {
    send: async () => {
      throw Object.assign(new Error('google token endpoint 400: invalid_grant'), { code: 'invalid_grant' });
    },
  });
  assert.equal(outcome, 'deferred');
  const saved = db.table.get('s1');
  assert.equal(saved.status, 'pending', 'must stay schedulable, never dropped');
  assert.equal(saved.attemptCount, 0, 'a connection outage is not the message failing');
  assert.equal(saved.connectionDeferredCount, 1);
  assert.ok(saved.nextRetryAt instanceof Date);
  assert.match(saved.failureReason, /Google/);
});

test('a genuine send failure retries with backoff, then exhausts to failed', async () => {
  const failing = { send: async () => { throw Object.assign(new Error('boom'), { code: 'send_failed' }); } };

  const row = baseRow({ attemptCount: 0 });
  const db = fakeDb([row]);
  assert.equal(await deliverScheduledEmail(db, row, failing), 'retry');
  let saved = db.table.get('s1');
  assert.equal(saved.status, 'pending');
  assert.equal(saved.attemptCount, 1);
  assert.ok(saved.nextRetryAt instanceof Date);

  // Last allowed attempt (MAX_ATTEMPTS = 6).
  const lastRow = baseRow({ attemptCount: 5 });
  const db2 = fakeDb([lastRow]);
  assert.equal(await deliverScheduledEmail(db2, lastRow, failing), 'failed');
  saved = db2.table.get('s1');
  assert.equal(saved.status, 'failed');
  assert.equal(saved.nextRetryAt, null);
  assert.match(saved.failureReason, /send_failed/);
});

test('the claim is always released so a stuck row cannot block forever', async () => {
  for (const scenario of [
    { send: async () => ({ gmailMessageId: 'g', threadId: null }) },
    { send: async () => { throw Object.assign(new Error('x'), { code: 'send_failed' }); } },
    { send: async () => { throw Object.assign(new Error('x'), { code: 'no_connected_account' }); } },
  ]) {
    const row = baseRow();
    const db = fakeDb([row]);
    await deliverScheduledEmail(db, row, scenario);
    assert.equal(db.table.get('s1').claimedAt, null);
    assert.equal(db.table.get('s1').claimedBy, null);
  }
});
