import test from 'node:test';
import assert from 'node:assert/strict';
import { settlePaymentFromIpn } from './icountWebhook.js';

// The automatic payment → WON path: a PAID iCount document (receipt / invrec)
// freshly recorded by this IPN settles the deal through the canonical WON
// transition. A duplicate/replayed IPN, a non-paid doctype or an unrecognized
// payload must leave deal state untouched — a replay must never re-close a
// deliberately reopened deal.

const log = { log() {}, error() {} };

const captured = (over = {}) => ({
  status: 'captured', isPaid: true, doctype: 'receipt', docnum: '123', amountMinor: 150000, currency: 'ILS', ...over,
});

test('a freshly captured receipt IPN settles WON with the verified amount', async () => {
  const settleCalls = [];
  const settle = async (_c, args) => {
    settleCalls.push(args);
    return { wonNow: true };
  };
  const r = await settlePaymentFromIpn('d1', captured(), { client: {}, settle, log });
  assert.equal(r.settled, true);
  assert.equal(settleCalls.length, 1);
  assert.equal(settleCalls[0].dealId, 'd1');
  assert.equal(settleCalls[0].paymentAmountMinor, 150000);
});

test('a NON-paid doctype (invoice) never settles', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settlePaymentFromIpn('d1', captured({ isPaid: false, doctype: 'invoice' }), { client: {}, settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'not_paid_doctype');
  assert.equal(settled, false);
});

test('a DUPLICATE IPN never settles — a replay must not re-close a reopened deal', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settlePaymentFromIpn('d1', captured({ status: 'duplicate' }), { client: {}, settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'duplicate_ipn');
  assert.equal(settled, false);
});

test('an unrecognized payload never drives WON', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settlePaymentFromIpn('d1', captured({ status: 'unrecognized', docnum: null }), { client: {}, settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'unrecognized_payload');
  assert.equal(settled, false);
});

test('a transient capture ERROR on a valid identity still settles (iCount never retries)', async () => {
  const settle = async () => ({ wonNow: true });
  const r = await settlePaymentFromIpn('d1', captured({ status: 'error' }), { client: {}, settle, log });
  assert.equal(r.settled, true);
});

test('missing dealId never settles', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settlePaymentFromIpn(null, captured(), { client: {}, settle, log });
  assert.equal(r.settled, false);
  assert.equal(settled, false);
});

test('idempotent: an already-WON deal reports alreadyWon (→ Report #1), not a second settlement', async () => {
  const settle = async () => ({ alreadyWon: true });
  const r = await settlePaymentFromIpn('d1', captured(), { client: {}, settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.alreadyWon, true);
});

test('a thrown settlement is swallowed (webhook must always 200)', async () => {
  const settle = async () => { throw new Error('db down'); };
  const r = await settlePaymentFromIpn('d1', captured(), { client: {}, settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'error');
});
