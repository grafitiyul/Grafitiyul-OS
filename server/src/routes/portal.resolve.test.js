import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePerson } from './portal.js';

// Guide token resolver security suite (incident 2026-07-13). The resolver
// must: match the EXACT token only, never reveal existence of an unknown
// token, and fail closed for disabled / blocked guides.

// A fake prisma whose personRef.findUnique behaves like a real unique lookup
// on portalToken — it returns a row ONLY for the exact stored token.
function fakeDb(rows) {
  return {
    personRef: {
      findUnique: async ({ where }) =>
        rows.find((r) => r.portalToken === where.portalToken) || null,
    },
  };
}

const ACTIVE = {
  id: 'p1',
  portalToken: 'exact_ACTIVE_tok',
  portalEnabled: true,
  status: 'active',
};
const DISABLED = {
  id: 'p2',
  portalToken: 'exact_DISABLED_tok',
  portalEnabled: false,
  status: 'active',
};
const BLOCKED = {
  id: 'p3',
  portalToken: 'exact_BLOCKED_tok',
  portalEnabled: true,
  status: 'blocked',
};

test('exact valid token resolves the right person', async () => {
  const r = await resolvePerson('exact_ACTIVE_tok', fakeDb([ACTIVE, DISABLED, BLOCKED]));
  assert.equal(r.error, undefined);
  assert.equal(r.person.id, 'p1');
});

test('unknown token → not_found (does not leak existence)', async () => {
  const r = await resolvePerson('no_such_token', fakeDb([ACTIVE]));
  assert.deepEqual(r, { error: 'not_found' });
});

test('one-character-off token → not_found (no fuzzy match)', async () => {
  const r = await resolvePerson('exact_ACTIVE_toX', fakeDb([ACTIVE]));
  assert.equal(r.error, 'not_found');
});

test('empty / non-string token → not_found', async () => {
  for (const bad of ['', null, undefined, 123]) {
    const r = await resolvePerson(bad, fakeDb([ACTIVE]));
    assert.equal(r.error, 'not_found');
  }
});

test('valid token but portal disabled → disabled (fails closed)', async () => {
  const r = await resolvePerson('exact_DISABLED_tok', fakeDb([ACTIVE, DISABLED]));
  assert.equal(r.error, 'disabled');
});

test('valid token but blocked status → disabled (revoked access)', async () => {
  const r = await resolvePerson('exact_BLOCKED_tok', fakeDb([ACTIVE, BLOCKED]));
  assert.equal(r.error, 'disabled');
});
