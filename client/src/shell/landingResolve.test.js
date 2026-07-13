import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanding } from './landingResolve.js';

// Security incident 2026-07-13 regression suite: the bare root and the
// launcher must resolve a guide-portal token ONLY from the explicit URL,
// never from device storage. `resolveLanding` has no storage access at all,
// so these tests also document that the resolution is a pure function of the
// URL inputs.

test('bare "/" with no URL token → admin (never a portal)', () => {
  const r = resolveLanding({ pathToken: null, queryToken: null, isLaunchPath: false });
  assert.deepEqual(r, { kind: 'admin', to: '/admin' });
});

test('"/" ignores any ambient device state — inputs are URL-only', () => {
  // There is no storage argument to pass; a device that had previously
  // opened /p/<token> cannot influence this result. Bare root stays admin.
  const r = resolveLanding({ pathToken: null, queryToken: null, isLaunchPath: false });
  assert.equal(r.kind, 'admin');
});

test('/launch with no URL token → missing screen (fail closed, not a portal)', () => {
  const r = resolveLanding({ pathToken: null, queryToken: null, isLaunchPath: true });
  assert.deepEqual(r, { kind: 'missing' });
});

test('/launch/:token (valid) → that exact portal', () => {
  const r = resolveLanding({ pathToken: 'abc123_TOKEN-x', queryToken: null, isLaunchPath: true });
  assert.deepEqual(r, { kind: 'portal', to: '/p/abc123_TOKEN-x' });
});

test('?p=<token> (valid) → that exact portal', () => {
  const r = resolveLanding({ pathToken: null, queryToken: 'RAFAEL_tok9', isLaunchPath: false });
  assert.deepEqual(r, { kind: 'portal', to: '/p/RAFAEL_tok9' });
});

test('malformed path token is treated as no token', () => {
  // Contains characters outside [A-Za-z0-9_-] → not a token.
  const r = resolveLanding({ pathToken: 'has/slash', queryToken: null, isLaunchPath: false });
  assert.equal(r.kind, 'admin');
});

test('empty-string tokens are treated as no token', () => {
  const r = resolveLanding({ pathToken: '', queryToken: '', isLaunchPath: false });
  assert.equal(r.kind, 'admin');
});

test('path token wins over query token when both present', () => {
  const r = resolveLanding({ pathToken: 'pathTok', queryToken: 'queryTok', isLaunchPath: true });
  assert.equal(r.to, '/p/pathTok');
});
