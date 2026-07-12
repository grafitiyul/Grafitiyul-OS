import test from 'node:test';
import assert from 'node:assert/strict';
import './whatsapp.js'; // side-effect: registers the issue type + detector
import { issueTypeDef } from '../registry.js';

const DEF = issueTypeDef('whatsapp_scheduled_stuck');

test('the whatsapp stuck issue type is registered', () => {
  assert.ok(DEF, 'issue type registered on import');
});

test('buildActions offers send/reschedule/cancel and Open Deal when a deal is known', () => {
  const actions = DEF.buildActions({ data: { messageId: 'm1', chatId: 'c1', deal: { id: 'd1', orderNo: 27500 } } });
  const keys = actions.map((a) => a.key);
  assert.deepEqual(keys, ['send_now', 'reschedule', 'cancel', 'open_deal']);
  const openDeal = actions.find((a) => a.key === 'open_deal');
  assert.equal(openDeal.target.orderNo, 27500);
  assert.equal(actions.find((a) => a.key === 'cancel').style, 'danger');
});

test('buildActions falls back to Open WhatsApp when no deal is linked', () => {
  const actions = DEF.buildActions({ data: { messageId: 'm1', chatId: 'c1', deal: null } });
  const keys = actions.map((a) => a.key);
  assert.ok(keys.includes('open_whatsapp'));
  assert.ok(!keys.includes('open_deal'));
});

test('send_now re-arms a skipped/failed message to pending at now', async () => {
  const calls = [];
  const client = {
    whatsAppScheduledMessage: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };
  const result = await DEF.serverActions.send_now(client, { data: { messageId: 'm1' } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.resolve, { resolution: 'send_now' });
  const { where, data } = calls[0];
  assert.deepEqual(where.status, { in: ['skipped', 'failed'] });
  assert.equal(data.status, 'pending');
  assert.equal(data.attemptCount, 0);
  assert.equal(data.failureReason, null);
  assert.ok(data.scheduledAt instanceof Date);
});

test('send_now is a no-op (409-style) when the message already left the stuck state', async () => {
  const client = {
    whatsAppScheduledMessage: { updateMany: async () => ({ count: 0 }) },
  };
  const result = await DEF.serverActions.send_now(client, { data: { messageId: 'm1' } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_resendable');
});

test('recheck resolves once the message is no longer skipped/failed', async () => {
  const client = {
    whatsAppScheduledMessage: { findUnique: async () => ({ status: 'sent' }) },
  };
  assert.equal(await DEF.recheck(client, { data: { messageId: 'm1' } }), false);
});

test('recheck keeps the issue while the message is still failed', async () => {
  const client = {
    whatsAppScheduledMessage: { findUnique: async () => ({ status: 'failed' }) },
  };
  assert.equal(await DEF.recheck(client, { data: { messageId: 'm1' } }), true);
});
