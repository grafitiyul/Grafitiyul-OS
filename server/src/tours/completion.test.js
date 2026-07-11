import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_SUMMARY_ROLES,
  businessToday,
  midnightAfterMs,
  summaryCompletionState,
  completeTour,
  reopenTour,
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

function fakeTourClient(tour, { bookings = [], frozenUpdates = [] } = {}) {
  const calls = { updates: [], timeline: [], frozenUpdates };
  return {
    calls,
    tourEvent: {
      findUnique: async () => tour,
      update: async (args) => calls.updates.push(args),
    },
    booking: { findMany: async () => bookings },
    questionnaireSubmission: {
      updateMany: async (args) => calls.frozenUpdates.push(args),
    },
    timelineEntry: { create: async (args) => calls.timeline.push(args) },
  };
}

test('completeTour: scheduled → completed with reason + timeline event (manual, on tour day)', async () => {
  const client = fakeTourClient({ id: 't1', status: 'scheduled', date: businessToday() });
  const res = await completeTour(client, 't1', { reason: 'manual', actorName: 'דורון' });
  assert.deepEqual(res, { ok: true, already: false });
  assert.equal(client.calls.updates[0].data.status, 'completed');
  assert.equal(client.calls.updates[0].data.completedReason, 'manual');
  assert.ok(client.calls.updates[0].data.completedAt instanceof Date);
  assert.equal(client.calls.timeline.length, 1);
  assert.match(client.calls.timeline[0].data.body, /הסתיים/);
  assert.match(client.calls.timeline[0].data.body, /דורון/);
});

test('completeTour: MANUAL completion is same-day only (business TZ)', async () => {
  // Future tour — refused.
  const future = await completeTour(
    fakeTourClient({ id: 't1', status: 'scheduled', date: '2099-01-01' }),
    't1',
    { reason: 'manual' },
  );
  assert.deepEqual(future, { ok: false, error: 'not_tour_day' });

  // Past tour — refused for MANUAL too (midnight owns overdue tours).
  const past = await completeTour(
    fakeTourClient({ id: 't1', status: 'scheduled', date: '2020-01-01' }),
    't1',
    { reason: 'manual' },
  );
  assert.deepEqual(past, { ok: false, error: 'not_tour_day' });

  // The AUTOMATIC triggers are unaffected by the same-day rule.
  const midnight = await completeTour(
    fakeTourClient({ id: 't1', status: 'scheduled', date: '2020-01-01' }),
    't1',
    { reason: 'midnight' },
  );
  assert.equal(midnight.ok, true);
  const summaries = await completeTour(
    fakeTourClient({ id: 't1', status: 'scheduled', date: '2099-01-01' }),
    't1',
    { reason: 'summaries' },
  );
  assert.equal(summaries.ok, true);
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

// ── the ONE completion reversal (fake client) ────────────────────────────────

test('reopenTour: completed → scheduled, clears completion, unfreezes, records timeline', async () => {
  const completedAt = new Date('2026-07-11T15:36:06Z');
  const client = fakeTourClient(
    {
      id: 't1',
      status: 'completed',
      date: '2099-01-01',
      completedAt,
      completedReason: 'manual',
    },
    { bookings: [{ id: 'b1' }, { id: 'b2' }] },
  );
  const res = await reopenTour(client, 't1', { actorName: 'דורון' });
  assert.deepEqual(res, { ok: true });

  const patch = client.calls.updates[0].data;
  assert.equal(patch.status, 'scheduled');
  assert.equal(patch.completedAt, null);
  assert.equal(patch.completedReason, null);
  // Calendar reconciles the SAME event (dirty flag) — never a duplicate.
  assert.equal(patch.gcalSyncStatus, 'pending');

  // Unfreeze ONLY submissions frozen by THIS completion (frozenAt >= completedAt),
  // on the tour itself AND its bookings' coordination forms.
  assert.equal(client.calls.frozenUpdates.length, 1);
  const where = client.calls.frozenUpdates[0].where;
  assert.deepEqual(where.frozenAt, { gte: completedAt });
  assert.deepEqual(where.OR, [
    { subjectType: 'tour_event', subjectId: 't1' },
    { subjectType: 'booking', subjectId: { in: ['b1', 'b2'] } },
  ]);
  assert.deepEqual(client.calls.frozenUpdates[0].data, { frozenAt: null });

  assert.equal(client.calls.timeline.length, 1);
  assert.match(client.calls.timeline[0].data.body, /הוחזר/);
  assert.match(client.calls.timeline[0].data.body, /דורון/);
  assert.equal(client.calls.timeline[0].data.data.event, 'reopened');
  assert.equal(client.calls.timeline[0].data.data.previousCompletedReason, 'manual');
});

test('reopenTour: refuses non-completed tours and past dates', async () => {
  const scheduled = await reopenTour(
    fakeTourClient({ id: 't1', status: 'scheduled', date: '2099-01-01' }),
    't1',
  );
  assert.deepEqual(scheduled, { ok: false, error: 'not_completed' });

  const cancelled = await reopenTour(
    fakeTourClient({ id: 't1', status: 'cancelled', date: '2099-01-01' }),
    't1',
  );
  assert.deepEqual(cancelled, { ok: false, error: 'not_completed' });

  const past = await reopenTour(
    fakeTourClient({ id: 't1', status: 'completed', date: '2020-01-01', completedAt: new Date() }),
    't1',
  );
  assert.deepEqual(past, { ok: false, error: 'date_passed' });

  const dateless = await reopenTour(
    fakeTourClient({ id: 't1', status: 'completed', date: null, completedAt: new Date() }),
    't1',
  );
  assert.deepEqual(dateless, { ok: false, error: 'date_passed' });
});

test('reopenTour: reopening today keeps working (date == today is still current)', async () => {
  const client = fakeTourClient(
    { id: 't1', status: 'completed', date: businessToday(), completedAt: new Date(), completedReason: 'manual' },
    { bookings: [] },
  );
  const res = await reopenTour(client, 't1');
  assert.deepEqual(res, { ok: true });
});
