// Preview primary-action regression tests: label + strict ordering.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryAction, runPrimaryAction, PRIMARY_ACTIONS } from './previewFlow.js';

// 1 — the button an operator actually sees
test('a deal that is NOT won offers "הפוך ל־WON ושלח מייל אישור"', () => {
  for (const status of ['open', 'lost', null, undefined]) {
    const a = primaryAction(status);
    assert.equal(a.kind, 'won_and_send', `status=${status}`);
    assert.equal(a.labelHe, 'הפוך ל־WON ושלח מייל אישור');
  }
});

test('an already-WON deal keeps the plain send button', () => {
  assert.equal(primaryAction('won').kind, 'send');
  assert.equal(primaryAction('won').labelHe, 'שלח מייל אישור');
});

test('there is NO "send anyway" action anywhere in the vocabulary', () => {
  const all = JSON.stringify(PRIMARY_ACTIONS);
  assert.doesNotMatch(all, /בכל זאת|anyway|allowNotWon/i);
});

// 2 — the transition runs exactly once, and first
test('not-won: transition runs exactly ONCE and before the send', async () => {
  const calls = [];
  const out = await runPrimaryAction({
    dealStatus: 'open',
    transition: async () => { calls.push('transition'); return { ok: true }; },
    send: async () => { calls.push('send'); return { ok: true }; },
  });
  assert.deepEqual(calls, ['transition', 'send'], 'WON first, then send — never the reverse');
  assert.equal(calls.filter((c) => c === 'transition').length, 1);
  assert.deepEqual(out, { transitioned: true, sent: true, error: null });
});

test('already won: the transition is never called', async () => {
  const calls = [];
  const out = await runPrimaryAction({
    dealStatus: 'won',
    transition: async () => { calls.push('transition'); return { ok: true }; },
    send: async () => { calls.push('send'); return { ok: true }; },
  });
  assert.deepEqual(calls, ['send']);
  assert.equal(out.transitioned, false);
});

// 3 — a failed transition sends NOTHING
test('failed transition → send is never called, error surfaces', async () => {
  let sent = false;
  const out = await runPrimaryAction({
    dealStatus: 'open',
    transition: async () => ({ ok: false, error: 'won_missing_fields' }),
    send: async () => { sent = true; return { ok: true }; },
  });
  assert.equal(sent, false, 'no snapshot, no queue row, no timeline entry');
  assert.deepEqual(out, { transitioned: false, sent: false, error: 'won_missing_fields' });
});

test('a transition that throws-shaped-null also blocks the send', async () => {
  let sent = false;
  const out = await runPrimaryAction({
    dealStatus: 'open',
    transition: async () => null,
    send: async () => { sent = true; return { ok: true }; },
  });
  assert.equal(sent, false);
  assert.equal(out.error, 'won_transition_failed');
});

test('a send failure after a successful transition is reported, not hidden', async () => {
  const out = await runPrimaryAction({
    dealStatus: 'open',
    transition: async () => ({ ok: true }),
    send: async () => ({ ok: false, error: 'no_connected_account' }),
  });
  assert.equal(out.transitioned, true);
  assert.equal(out.sent, false);
  assert.equal(out.error, 'no_connected_account');
});
