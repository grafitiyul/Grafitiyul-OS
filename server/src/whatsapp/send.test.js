import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppText, phoneToJid, defaultSendAccount } from './send.js';

test('phoneToJid: normalizes an Israeli number to a WhatsApp private jid', () => {
  assert.equal(phoneToJid('050-123-4567'), '972501234567@s.whatsapp.net');
  assert.equal(phoneToJid('+972 50 1234567'), '972501234567@s.whatsapp.net');
  assert.equal(phoneToJid('123'), null); // unusable
});

test('defaultSendAccount: env override wins, else single bridge, else main', () => {
  const prev = process.env.WHATSAPP_DEFAULT_ACCOUNT;
  process.env.WHATSAPP_DEFAULT_ACCOUNT = 'office';
  assert.equal(defaultSendAccount(), 'office');
  if (prev === undefined) delete process.env.WHATSAPP_DEFAULT_ACCOUNT;
  else process.env.WHATSAPP_DEFAULT_ACCOUNT = prev;
});

test('sendWhatsAppText: invalid phone throws invalid_phone before any bridge call', async () => {
  let called = false;
  await assert.rejects(
    () => sendWhatsAppText('123', 'hi', { bridge: async () => { called = true; } }),
    (e) => e.code === 'invalid_phone',
  );
  assert.equal(called, false);
});

test('sendWhatsAppText: a real bridge ack resolves ok with the externalMessageId', async () => {
  const calls = [];
  const bridge = async (account, path, opts) => {
    calls.push({ account, path, body: opts.body });
    return { externalMessageId: 'wamid.123' };
  };
  const out = await sendWhatsAppText('0501234567', 'שלום', { accountId: 'main', idempotencyKey: 'k1', bridge });
  assert.deepEqual(out, { ok: true, externalMessageId: 'wamid.123', accountId: 'main' });
  assert.equal(calls[0].path, '/send');
  assert.equal(calls[0].body.jid, '972501234567@s.whatsapp.net');
  assert.equal(calls[0].body.idempotencyKey, 'k1');
});

test('sendWhatsAppText: a bridge failure REJECTS (never a false success)', async () => {
  const bridge = async () => {
    const e = new Error('bridge_error: not_registered');
    e.code = 'bridge_error';
    throw e;
  };
  await assert.rejects(() => sendWhatsAppText('0501234567', 'x', { accountId: 'main', bridge }), (e) => e.code === 'bridge_error');
});

test('sendWhatsAppText: a network blip collapses to bridge_unreachable', async () => {
  const bridge = async () => {
    throw new Error('ECONNRESET');
  };
  await assert.rejects(() => sendWhatsAppText('0501234567', 'x', { accountId: 'main', bridge }), (e) => e.code === 'bridge_unreachable');
});
