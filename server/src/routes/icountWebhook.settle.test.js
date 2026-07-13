import test from 'node:test';
import assert from 'node:assert/strict';
import { settleGroupRegistrationFromIpn } from './icountWebhook.js';

// The ONLY automatic pay-now/send-link → WON path: a PAID iCount document
// (receipt / invrec) on the IPN for a deal that is holding a seat. Everything
// else must leave deal state untouched.

function client({ pending }) {
  return {
    ticketRegistration: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where.status.in, ['held', 'expired']);
        return pending ? { id: 'reg1' } : null;
      },
    },
  };
}

const log = { log() {}, error() {} };

test('a receipt IPN for a deal with a pending hold settles WON', async () => {
  const settleCalls = [];
  const settle = async (_c, args) => {
    settleCalls.push(args);
    return { wonNow: true };
  };
  const r = await settleGroupRegistrationFromIpn('d1', { doctype: 'receipt' }, { client: client({ pending: true }), settle, log });
  assert.equal(r.settled, true);
  assert.equal(settleCalls.length, 1);
  assert.equal(settleCalls[0].dealId, 'd1');
});

test('a NON-paid doctype (invoice) never settles', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settleGroupRegistrationFromIpn('d1', { doctype: 'invoice' }, { client: client({ pending: true }), settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'not_paid_doctype');
  assert.equal(settled, false);
});

test('a paid IPN for a deal with NO pending hold never settles', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settleGroupRegistrationFromIpn('d1', { doctype: 'invrec' }, { client: client({ pending: false }), settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'no_pending_hold');
  assert.equal(settled, false);
});

test('missing dealId never settles', async () => {
  let settled = false;
  const settle = async () => { settled = true; return { wonNow: true }; };
  const r = await settleGroupRegistrationFromIpn(null, { doctype: 'receipt' }, { client: client({ pending: true }), settle, log });
  assert.equal(r.settled, false);
  assert.equal(settled, false);
});

test('idempotent: an already-WON deal reports alreadyWon, not a second settlement', async () => {
  const settle = async () => ({ alreadyWon: true });
  const r = await settleGroupRegistrationFromIpn('d1', { doctype: 'receipt' }, { client: client({ pending: true }), settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.alreadyWon, true);
});

test('a thrown settlement is swallowed (webhook must always 200)', async () => {
  const settle = async () => { throw new Error('db down'); };
  const r = await settleGroupRegistrationFromIpn('d1', { doctype: 'receipt' }, { client: client({ pending: true }), settle, log });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'error');
});
