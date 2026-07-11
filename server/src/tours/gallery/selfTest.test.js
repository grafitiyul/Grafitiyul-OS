import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadReadinessSelfTest } from './selfTest.js';

// Regression tests for the production incident (2026-07-11): the bucket had
// NO CORS policy — server-side PUTs worked, browser preflights got 403 with
// no CORS headers, and every upload from every surface failed. The self-test
// must name that exact state (and the healthy state) unambiguously.

function fakeStorage() {
  const state = { deleted: [] };
  return {
    state,
    isConfigured: () => true,
    presignPut: async () => 'https://bucket.acct.r2.cloudflarestorage.com/k?sig=1',
    presignGet: async () => 'https://bucket.acct.r2.cloudflarestorage.com/k?sig=2',
    deleteObject: async (key) => {
      state.deleted.push(key);
    },
  };
}

function fakeFetch({ corsConfigured }) {
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    const headers = new Map();
    let status = 200;
    if (method === 'OPTIONS') {
      // R2 behavior: no policy → 403 without CORS headers; policy → 200 + headers.
      if (corsConfigured) {
        headers.set('access-control-allow-origin', 'https://app.grafitiyul.co.il');
      } else {
        status = 403;
      }
    }
    if (method === 'GET' && corsConfigured) {
      headers.set('access-control-allow-origin', 'https://app.grafitiyul.co.il');
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers.get(k.toLowerCase()) || null },
    };
  };
}

test('missing bucket CORS policy → ready=false, exact leg named, action given', async () => {
  const storage = fakeStorage();
  const result = await uploadReadinessSelfTest({
    storage,
    fetchImpl: fakeFetch({ corsConfigured: false }),
  });
  assert.equal(result.serverPut, 'ok', 'signing itself is healthy');
  assert.equal(result.corsPreflight, 'missing_cors_policy', 'the browser leg is the failure');
  assert.equal(result.ready, false);
  assert.match(result.requiredAction, /CORS/);
  assert.equal(storage.state.deleted.length, 1, 'probe object cleaned up');
});

test('healthy bucket → ready=true across all legs', async () => {
  const result = await uploadReadinessSelfTest({
    storage: fakeStorage(),
    fetchImpl: fakeFetch({ corsConfigured: true }),
  });
  assert.equal(result.serverPut, 'ok');
  assert.equal(result.corsPreflight, 'ok');
  assert.equal(result.corsGet, 'ok');
  assert.equal(result.ready, true);
  assert.equal(result.requiredAction, null);
});

test('unconfigured R2 reports the env problem, not a CORS problem', async () => {
  const result = await uploadReadinessSelfTest({
    storage: { isConfigured: () => false },
    fetchImpl: fakeFetch({ corsConfigured: true }),
  });
  assert.equal(result.ready, false);
  assert.match(result.requiredAction, /R2_/);
});

test('credentials/bucket failure is distinguished from CORS failure', async () => {
  const storage = fakeStorage();
  const failingFetch = async (url, options = {}) =>
    (options.method || 'GET') === 'PUT'
      ? { ok: false, status: 403, headers: { get: () => null } }
      : fakeFetch({ corsConfigured: false })(url, options);
  const result = await uploadReadinessSelfTest({ storage, fetchImpl: failingFetch });
  assert.equal(result.serverPut, 'http_403');
  assert.match(result.requiredAction, /credentials|env/i);
});
