import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rateLimit.js';

test('allows up to max in a window, then blocks, keyed independently', () => {
  const allow = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false); // 4th in window blocked
  assert.equal(allow('b'), true); // other keys unaffected
});

test('window expiry resets the count', async () => {
  const allow = createRateLimiter({ windowMs: 20, max: 1 });
  assert.equal(allow('k'), true);
  assert.equal(allow('k'), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(allow('k'), true);
});
