import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, idempotencyKeyFor } from './scheduledWorker.js';

function bridgeErr(code, status = 500) {
  const err = new Error(`bridge_error: ${code}`);
  err.code = 'bridge_error';
  err.status = status;
  err.data = { error: code };
  return err;
}

test('classify: terminal codes never retry', () => {
  assert.equal(classify(bridgeErr('whatsapp_number_not_found', 404)).kind, 'terminal');
  assert.equal(classify(bridgeErr('invalid_payload', 400)).kind, 'terminal');
});

test('classify: connection-level codes do not consume attempts', () => {
  for (const code of ['whatsapp_not_connected', 'send_timeout', 'on_whatsapp_timeout', 'bridge_auth_failed']) {
    assert.equal(classify(bridgeErr(code)).kind, 'retryable_connection', code);
  }
  const notConfigured = new Error('bridge_not_configured');
  notConfigured.code = 'bridge_not_configured';
  assert.equal(classify(notConfigured).kind, 'retryable_connection');
  // Network-level fetch failure (no structured payload)
  const netErr = new Error('fetch failed');
  netErr.code = 'bridge_error';
  assert.equal(classify(netErr).kind, 'retryable_connection');
});

test('classify: unknown send errors are retryable_send with a bounded code', () => {
  const c = classify(bridgeErr('x'.repeat(300)));
  assert.equal(c.kind, 'retryable_send');
  assert.ok(c.code.length <= 80);
});

test('idempotency key is deterministic across recovery (same id/time/attempt)', () => {
  const row = { id: 'abc', scheduledAt: new Date('2026-07-06T09:00:00.000Z'), attemptCount: 2 };
  assert.equal(idempotencyKeyFor(row), idempotencyKeyFor({ ...row }));
  assert.equal(idempotencyKeyFor(row), 'gos-sched-abc-2026-07-06T09:00:00.000Z-a2');
  // A NEW attempt gets a NEW key (a real retry may legitimately resend)…
  assert.notEqual(idempotencyKeyFor(row), idempotencyKeyFor({ ...row, attemptCount: 3 }));
  // …and a reschedule gets a new key too.
  assert.notEqual(
    idempotencyKeyFor(row),
    idempotencyKeyFor({ ...row, scheduledAt: new Date('2026-07-06T10:00:00.000Z') }),
  );
});
