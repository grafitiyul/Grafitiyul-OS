import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_SUMMARY_ROLES,
  businessToday,
  midnightAfterMs,
  summaryCompletionState,
  completeTour,
} from './completion.js';

// ── business-timezone midnight (Asia/Jerusalem) ─────────────────────────────

test('midnightAfterMs: winter date (UTC+2) → 22:00Z of the same calendar day', () => {
  assert.equal(midnightAfterMs('2026-01-15'), Date.parse('2026-01-15T22:00:00Z'));
});

test('midnightAfterMs: summer date (UTC+3 DST) → 21:00Z of the same calendar day', () => {
  assert.equal(midnightAfterMs('2026-07-15'), Date.parse('2026-07-15T21:00:00Z'));
});

test('midnightAfterMs: garbage date → NaN (never locks anything)', () => {
  assert.ok(Number.isNaN(midnightAfterMs('')));
});

test('businessToday renders the Israel calendar date, not the server one', () => {
  // 2026-07-14T22:30Z is already July 15 in Israel (UTC+3).
  assert.equal(businessToday(Date.parse('2026-07-14T22:30:00Z')), '2026-07-15');
  assert.equal(businessToday(Date.parse('2026-07-14T20:30:00Z')), '2026-07-14');
});

// ── required-summaries state (fake client — no DB) ──────────────────────────

function fakeStateClient({ assignments, submittedScopes }) {
  return {
    tourAssignment: { findMany: async () => assignments },
    questionnaireSubmission: {
      findMany: async () => submittedScopes.map((s) => ({ actorScope: s })),
    },
  };
}

const LEAD = { externalPersonId: 'p1', displayName: 'דנה', role: 'lead_guide' };
const GUIDE = { externalPersonId: 'p2', displayName: 'יואב', role: 'guide' };

test('required roles are lead_guide + guide only', () => {
  assert.deepEqual(REQUIRED_SUMMARY_ROLES, ['lead_guide', 'guide']);
});

test('allSubmitted only when EVERY required guide submitted', async () => {
  const partial = await summaryCompletionState(
    fakeStateClient({ assignments: [LEAD, GUIDE], submittedScopes: ['p1'] }),
    't1',
  );
  assert.equal(partial.allSubmitted, false);
  assert.deepEqual(partial.missing.map((m) => m.externalPersonId), ['p2']);

  const full = await summaryCompletionState(
    fakeStateClient({ assignments: [LEAD, GUIDE], submittedScopes: ['p1', 'p2'] }),
    't1',
  );
  assert.equal(full.allSubmitted, true);
  assert.equal(full.missing.length, 0);
});

test('a tour with NO required guides never auto-completes via summaries', async () => {
  const state = await summaryCompletionState(
    fakeStateClient({ assignments: [], submittedScopes: [] }),
    't1',
  );
  assert.equal(state.allSubmitted, false);
});

// ── the ONE transition (fake client) ─────────────────────────────────────────

function fakeTourClient(tour) {
  const calls = { updates: [], timeline: [] };
  return {
    calls,
    tourEvent: {
      findUnique: async () => tour,
      update: async (args) => calls.updates.push(args),
    },
    timelineEntry: { create: async (args) => calls.timeline.push(args) },
  };
}

test('completeTour: scheduled → completed with reason + timeline event', async () => {
  const client = fakeTourClient({ id: 't1', status: 'scheduled', date: '2026-07-10' });
  const res = await completeTour(client, 't1', { reason: 'manual', actorName: 'דורון' });
  assert.deepEqual(res, { ok: true, already: false });
  assert.equal(client.calls.updates[0].data.status, 'completed');
  assert.equal(client.calls.updates[0].data.completedReason, 'manual');
  assert.ok(client.calls.updates[0].data.completedAt instanceof Date);
  assert.equal(client.calls.timeline.length, 1);
  assert.match(client.calls.timeline[0].data.body, /הסתיים/);
  assert.match(client.calls.timeline[0].data.body, /דורון/);
});

test('completeTour: idempotent on completed, refuses cancelled and postponed', async () => {
  const done = await completeTour(fakeTourClient({ id: 't1', status: 'completed' }), 't1', { reason: 'midnight' });
  assert.deepEqual(done, { ok: true, already: true });

  const cancelled = await completeTour(fakeTourClient({ id: 't1', status: 'cancelled' }), 't1', { reason: 'manual' });
  assert.deepEqual(cancelled, { ok: false, error: 'tour_cancelled' });

  // A postponed tour has no date — nothing to complete until rescheduled.
  const postponed = await completeTour(fakeTourClient({ id: 't1', status: 'postponed' }), 't1', { reason: 'manual' });
  assert.deepEqual(postponed, { ok: false, error: 'tour_postponed' });
});

test('completeTour: explicit completedAt (midnight sweep) is stamped as-is', async () => {
  const client = fakeTourClient({ id: 't1', status: 'scheduled', date: '2026-07-10' });
  const mid = new Date(midnightAfterMs('2026-07-10'));
  await completeTour(client, 't1', { reason: 'midnight', completedAt: mid });
  assert.equal(client.calls.updates[0].data.completedAt.getTime(), mid.getTime());
});
