import test from 'node:test';
import assert from 'node:assert/strict';
import { numericIdResolver } from './numericIdParam.js';

// Unit suite for the shared ":id" numeric-URL resolver (the Deal orderNo
// pattern, now also Organization.orgNo / Contact.contactNo). The resolver is a
// pure express param handler with an injected unique lookup, so it is tested
// here without express or a database.

// Fake unique lookup: resolves { id } for known numbers, null otherwise.
function fakeFinder(rows, calls = []) {
  return async (n) => {
    calls.push(n);
    const hit = rows.find((r) => r.no === n);
    return hit ? { id: hit.id } : null;
  };
}

function run(resolver, value) {
  return new Promise((resolve, reject) => {
    const req = { params: { id: value } };
    resolver(req, {}, (err) => (err ? reject(err) : resolve(req)), value);
  });
}

test('numeric value → rewritten to the cuid of the matching row', async () => {
  const resolver = numericIdResolver(fakeFinder([{ no: 10001, id: 'cuid_org_1' }]));
  const req = await run(resolver, '10001');
  assert.equal(req.params.id, 'cuid_org_1');
});

test('unknown number → param left unchanged (handler lookup will 404)', async () => {
  const resolver = numericIdResolver(fakeFinder([{ no: 10001, id: 'cuid_org_1' }]));
  const req = await run(resolver, '99999');
  assert.equal(req.params.id, '99999');
});

test('cuid passthrough — lookup is never called', async () => {
  const calls = [];
  const resolver = numericIdResolver(fakeFinder([{ no: 10001, id: 'cuid_org_1' }], calls));
  const req = await run(resolver, 'clx123abc456');
  assert.equal(req.params.id, 'clx123abc456');
  assert.equal(calls.length, 0);
});

test('digits above int4 range → passthrough, no lookup (avoids P2033)', async () => {
  const calls = [];
  const resolver = numericIdResolver(fakeFinder([], calls));
  for (const big of ['2147483648', '99999999999999999999']) {
    const req = await run(resolver, big);
    assert.equal(req.params.id, big);
  }
  assert.equal(calls.length, 0);
});

test('mixed alphanumeric / empty-ish values → passthrough, no lookup', async () => {
  const calls = [];
  const resolver = numericIdResolver(fakeFinder([], calls));
  for (const v of ['12ab', 'a123', '12 3', '1.5', '-5']) {
    const req = await run(resolver, v);
    assert.equal(req.params.id, v);
  }
  assert.equal(calls.length, 0);
});

test('lookup failure propagates to next(err)', async () => {
  const boom = new Error('db down');
  const resolver = numericIdResolver(async () => {
    throw boom;
  });
  await assert.rejects(() => run(resolver, '10001'), boom);
});
