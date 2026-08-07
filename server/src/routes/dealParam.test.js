// The shared deal URL-param resolver, and the retired-deal WRITE BLOCK it
// carries. Both halves matter and they are deliberately in one place:
//
//   • a deal URL may be a cuid OR the business "מספר הזמנה", and every
//     deal-scoped router must accept both (production bug #26340);
//   • a deal retired by a merge must stay fully READABLE and must refuse
//     WRITES — and that guard lives here, in the one resolver every deal-scoped
//     router already calls, so a router added tomorrow inherits it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dealParamHandler } from './dealParam.js';

function makeDb(deals) {
  const rows = Object.values(deals);
  return {
    deal: {
      findUnique: async ({ where }) => {
        if (where.id) return deals[where.id] || null;
        if (where.orderNo != null) return rows.find((r) => r.orderNo === where.orderNo) || null;
        return null;
      },
    },
  };
}

const DEALS = {
  live: { id: 'live', orderNo: 27042, mergedIntoDealId: null },
  retired: { id: 'retired', orderNo: 27100, mergedIntoDealId: 'live' },
};

// Drive the handler and report what happened: next() / a JSON response / error.
function run(handler, { method, value, paramName = 'dealId' }) {
  return new Promise((resolve, reject) => {
    const req = { method, params: { [paramName]: value } };
    let status = null;
    const res = {
      status(s) { status = s; return this; },
      json(body) { resolve({ outcome: 'response', status, body, params: req.params }); },
    };
    handler(req, res, (err) => {
      if (err) return reject(err);
      resolve({ outcome: 'next', params: req.params });
    });
  });
}

// ── the resolver half ───────────────────────────────────────────────────────

test('an order number is swapped for the internal id', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'GET', value: '27042' });
  assert.equal(r.outcome, 'next');
  assert.equal(r.params.dealId, 'live');
});

test('a cuid passes through untouched', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'GET', value: 'live' });
  assert.equal(r.outcome, 'next');
  assert.equal(r.params.dealId, 'live');
});

test('an unknown order number falls through — the handler\'s own lookup 404s', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'GET', value: '99999' });
  assert.equal(r.outcome, 'next');
  assert.equal(r.params.dealId, '99999', 'unchanged');
});

test('an out-of-range number is never sent to an int4 column', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'GET', value: '99999999999' });
  assert.equal(r.outcome, 'next');
});

// ── the write block ─────────────────────────────────────────────────────────

test('a retired deal is fully READABLE', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const r = await run(handler, { method, value: 'retired' });
    assert.equal(r.outcome, 'next', `${method} passes`);
  }
});

test('a WRITE to a retired deal is refused with 409 and the survivor named', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await run(handler, { method, value: 'retired' });
    assert.equal(r.outcome, 'response', `${method} is blocked`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'deal_retired_by_merge');
    assert.equal(r.body.survivorOrderNo, 27042);
    assert.match(r.body.messageHe, /27100/);
    assert.match(r.body.messageHe, /27042/);
  }
});

test('the block holds when the URL uses the ORDER NUMBER form', async () => {
  // The failure this prevents: resolving the number first and then guarding on
  // a value that never matched, so the guard silently stops guarding.
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'PUT', value: '27100' });
  assert.equal(r.outcome, 'response');
  assert.equal(r.status, 409);
  assert.equal(r.body.survivorOrderNo, 27042);
});

test('writes to a LIVE deal are never blocked', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'PUT', value: '27042' });
  assert.equal(r.outcome, 'next');
  assert.equal(r.params.dealId, 'live');
});

test('a write to an unknown deal falls through to the handler\'s own 404', async () => {
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS) });
  const r = await run(handler, { method: 'PUT', value: 'nope' });
  assert.equal(r.outcome, 'next', 'the guard refuses retired deals, not missing ones');
});

test('the block can be opted out of explicitly', async () => {
  // For a future router that legitimately writes history (none today) — the
  // opt-out is deliberate and visible at the registration site.
  const handler = dealParamHandler('dealId', { db: makeDb(DEALS), blockRetiredWrites: false });
  const r = await run(handler, { method: 'PUT', value: 'retired' });
  assert.equal(r.outcome, 'next');
});
