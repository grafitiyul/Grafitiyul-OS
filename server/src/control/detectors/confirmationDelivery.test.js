import test from 'node:test';
import assert from 'node:assert/strict';
import { runConfirmationDeliverySweep } from './confirmationDelivery.js';
import { issueTypeDef } from '../registry.js';

const TYPE = 'confirmation_email_delivery_failed';
const DEF = issueTypeDef(TYPE);

// THE regression wall for the #27099/#27100 control failure: the operator
// clicked "send again" on a broken address, a fresh queue row appeared, and the
// בקרה card auto-resolved 50 seconds later while the customer still had nothing.

/**
 * @param sends  [{ dealId, scheduledEmailId, createdAt, test? }] newest first
 * @param queue  { [scheduledEmailId]: { status, claimedAt?, failureReason? } }
 */
function fakeClient(sends, queue) {
  const raised = [];
  let resolvedWith = null;
  return {
    raised,
    get resolvedWith() { return resolvedWith; },
    confirmationEmailSend: {
      findMany: async () => sends.map((s) => ({
        dealId: s.dealId,
        scheduledEmailId: s.scheduledEmailId,
        subject: 'מייל אישור',
        recipientSnapshot: { name: 'הילה חדד סלומון', email: 'hilah19@gmail.com', ...(s.test ? { test: true } : {}) },
        createdAt: s.createdAt,
      })),
    },
    scheduledEmail: {
      findMany: async ({ where }) => where.id.in
        .filter((id) => queue[id])
        .map((id) => ({ id, ...queue[id] })),
    },
    deal: { findMany: async ({ where }) => where.id.in.map((id) => ({ id, orderNo: 27099 })) },
    operationalIssue: {
      // raiseIssue / resolveMissing go through these in the real service; the
      // sweep is exercised through the exported helpers instead, so capture at
      // that level via the module's own calls below.
    },
  };
}

// raiseIssue/resolveMissing hit the DB, so run the sweep against a client that
// records what they would write. They both take (client, …) and use only these.
function recordingClient(sends, queue) {
  const c = fakeClient(sends, queue);
  const calls = { raised: [], resolvedKeep: null };
  c.operationalIssue = {
    findUnique: async () => null,
    findFirst: async () => null,
    upsert: async ({ create }) => { calls.raised.push(create); return create; },
    create: async (args) => { calls.raised.push(args.data); return args.data; },
    update: async (args) => args.data,
    updateMany: async (args) => { calls.resolvedKeep = args; return { count: 0 }; },
    findMany: async () => [],
  };
  return { client: c, calls };
}

test('a QUEUED resend does NOT resolve the card when nothing was ever delivered', async () => {
  // Exactly the incident: an old failed send, then a fresh manual resend that is
  // merely queued. The deal MUST still be reported.
  const { client, calls } = recordingClient(
    [
      { dealId: 'd1', scheduledEmailId: 'q2', createdAt: '2026-08-07T12:07:36Z' },
      { dealId: 'd1', scheduledEmailId: 'q1', createdAt: '2026-08-06T11:50:26Z' },
    ],
    {
      q1: { status: 'failed', failureReason: 'send_failed: Invalid To header', attemptCount: 6 },
      q2: { status: 'pending', attemptCount: 4 },
    },
  );
  await runConfirmationDeliverySweep(client);
  assert.equal(calls.raised.length, 1, 'the deal must still carry an issue');
  assert.equal(calls.raised[0].data.dealId, 'd1');
  assert.equal(calls.raised[0].data.deliveryState, 'queued');
  assert.match(calls.raised[0].title, /ממתין לשליחה/);
});

test('a genuinely DELIVERED send resolves the card — the only thing that does', async () => {
  const { client, calls } = recordingClient(
    [
      { dealId: 'd1', scheduledEmailId: 'q2', createdAt: '2026-08-07T12:07:36Z' },
      { dealId: 'd1', scheduledEmailId: 'q1', createdAt: '2026-08-06T11:50:26Z' },
    ],
    {
      q1: { status: 'failed', failureReason: 'send_failed', attemptCount: 6 },
      q2: { status: 'sent', sentAt: '2026-08-07T12:09:00Z', gmailMessageId: 'abc' },
    },
  );
  await runConfirmationDeliverySweep(client);
  assert.equal(calls.raised.length, 0, 'delivered → nothing to report');
});

test('a terminal failure is reported WITH the provider reason', async () => {
  const { client, calls } = recordingClient(
    [{ dealId: 'd1', scheduledEmailId: 'q1', createdAt: '2026-08-06T11:50:26Z' }],
    { q1: { status: 'failed', failureReason: 'send_failed: Invalid To header', attemptCount: 6 } },
  );
  await runConfirmationDeliverySweep(client);
  assert.equal(calls.raised.length, 1);
  assert.equal(calls.raised[0].severity, 'warning');
  assert.equal(calls.raised[0].data.deliveryState, 'failed');
  assert.match(calls.raised[0].explanation, /Invalid To header/);
});

test('an operator CANCELLATION does not mask an earlier failure', async () => {
  const { client, calls } = recordingClient(
    [
      { dealId: 'd1', scheduledEmailId: 'q2', createdAt: '2026-08-07T12:07:36Z' },
      { dealId: 'd1', scheduledEmailId: 'q1', createdAt: '2026-08-06T11:50:26Z' },
    ],
    {
      q1: { status: 'failed', failureReason: 'send_failed', attemptCount: 6 },
      q2: { status: 'cancelled' },
    },
  );
  await runConfirmationDeliverySweep(client);
  assert.equal(calls.raised.length, 1, 'the failure behind the cancellation still stands');
  assert.equal(calls.raised[0].data.deliveryState, 'failed');
});

test('test sends are ignored entirely', async () => {
  const { client, calls } = recordingClient(
    [{ dealId: 'd1', scheduledEmailId: 'q1', createdAt: '2026-08-06T11:50:26Z', test: true }],
    { q1: { status: 'failed', failureReason: 'send_failed' } },
  );
  await runConfirmationDeliverySweep(client);
  assert.equal(calls.raised.length, 0);
});

test('the issue type is registered and its wording no longer promises a queue-close', () => {
  assert.ok(DEF);
  assert.match(DEF.fixHe, /הכנסה לתור אינה סגירה/);
});
