import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateDates,
  orderedStaff,
  findParallelTours,
  PARALLEL_WINDOW_MS,
  PARALLEL_STATUSES,
} from './parallelTours.js';

// ── candidateDates (pure) ─────────────────────────────────────────────────────

test('candidateDates returns the day and its two neighbours', () => {
  assert.deepEqual(candidateDates('2026-07-20'), ['2026-07-19', '2026-07-20', '2026-07-21']);
});

test('candidateDates is month-boundary safe', () => {
  assert.deepEqual(candidateDates('2026-07-31'), ['2026-07-30', '2026-07-31', '2026-08-01']);
  assert.deepEqual(candidateDates('2026-08-01'), ['2026-07-31', '2026-08-01', '2026-08-02']);
});

test('candidateDates is year-boundary safe', () => {
  assert.deepEqual(candidateDates('2026-12-31'), ['2026-12-30', '2026-12-31', '2027-01-01']);
});

test('candidateDates rejects a malformed date', () => {
  assert.deepEqual(candidateDates(''), []);
  assert.deepEqual(candidateDates(null), []);
});

// ── orderedStaff (pure) ───────────────────────────────────────────────────────

test('orderedStaff orders lead → guide → assistant and keeps display names', () => {
  const staff = orderedStaff([
    { displayName: 'עוזי', role: 'workshop_assistant' },
    { displayName: 'דנה', role: 'lead_guide' },
    { displayName: 'יואב', role: 'guide' },
  ]);
  assert.deepEqual(staff, [
    { displayName: 'דנה', role: 'lead_guide' },
    { displayName: 'יואב', role: 'guide' },
    { displayName: 'עוזי', role: 'workshop_assistant' },
  ]);
});

test('orderedStaff dedupes a repeated display name, keeping the most senior role', () => {
  const staff = orderedStaff([
    { displayName: 'דנה', role: 'guide' },
    { displayName: 'דנה', role: 'lead_guide' },
  ]);
  assert.deepEqual(staff, [{ displayName: 'דנה', role: 'lead_guide' }]);
});

test('orderedStaff ignores blank names and an unassigned tour', () => {
  assert.deepEqual(orderedStaff([{ displayName: '  ', role: 'guide' }]), []);
  assert.deepEqual(orderedStaff([]), []);
  assert.deepEqual(orderedStaff(null), []);
});

// ── findParallelTours (integration against a fake client) ─────────────────────

function tour(id, date, startTime, extra = {}) {
  return {
    id,
    date,
    startTime,
    status: 'scheduled',
    tourLanguage: 'he',
    product: { nameHe: `מוצר ${id}`, nameEn: null },
    productVariant: { location: null },
    location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
    assignments: [],
    supersededByTourEventId: null,
    ...extra,
  };
}

// Mimics the exact filters the selector delegates to the DB, plus occupancyFor's
// groupBy calls (registration seats + booking counts).
function fakeClient(all, seats = {}) {
  return {
    tourEvent: {
      findMany: async ({ where }) => {
        const dates = where.date.in;
        const notId = where.id.not;
        const statuses = where.status.in;
        return all.filter(
          (t) =>
            t.id !== notId &&
            dates.includes(t.date) &&
            t.startTime != null &&
            statuses.includes(t.status) &&
            t.supersededByTourEventId == null,
        );
      },
    },
    ticketRegistration: {
      groupBy: async ({ where }) =>
        where.tourEventId.in
          .filter((id) => seats[id] != null)
          .map((id) => ({ tourEventId: id, _sum: { quantity: seats[id] } })),
    },
    booking: { groupBy: async () => [] },
  };
}

async function parallelIds(all, viewed, seats) {
  const rows = await findParallelTours(fakeClient(all, seats), viewed);
  return rows.map((r) => r.id);
}

test('scenario 1 — no tours in the window → empty', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const all = [V, tour('A', '2026-07-20', '08:00'), tour('B', '2026-07-20', '16:00')];
  assert.deepEqual(await parallelIds(all, V), []);
});

test('scenario 2+3 — exactly 3h before and 3h after are included (inclusive)', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const all = [V, tour('before', '2026-07-20', '09:00'), tour('after', '2026-07-20', '15:00')];
  assert.deepEqual(await parallelIds(all, V), ['before', 'after']);
});

test('scenario 4 — 3h and 1 minute away is excluded on both sides', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const all = [V, tour('early', '2026-07-20', '08:59'), tour('late', '2026-07-20', '15:01')];
  assert.deepEqual(await parallelIds(all, V), []);
});

test('scenario 5 — cross-midnight forward (23:30 → next-day 01:30 included, 02:31 excluded)', async () => {
  const V = tour('V', '2026-07-20', '23:30');
  const all = [
    V,
    tour('nextIn', '2026-07-21', '01:30'), // +2h
    tour('nextOut', '2026-07-21', '02:31'), // +3h1m
  ];
  assert.deepEqual(await parallelIds(all, V), ['nextIn']);
});

test('scenario 5 — cross-midnight backward (00:30 → previous-day 22:30 included)', async () => {
  const V = tour('V', '2026-07-21', '00:30');
  const all = [V, tour('prev', '2026-07-20', '22:30')]; // -2h
  assert.deepEqual(await parallelIds(all, V), ['prev']);
});

test('scenario 6 — cancelled and postponed tours in the window are excluded', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const all = [
    V,
    tour('cancelled', '2026-07-20', '13:00', { status: 'cancelled' }),
    tour('postponed', '2026-07-20', '13:00', { status: 'postponed', date: null, startTime: null }),
    tour('superseded', '2026-07-20', '13:00', { supersededByTourEventId: 'X' }),
    tour('ok', '2026-07-20', '13:00'),
  ];
  assert.deepEqual(await parallelIds(all, V), ['ok']);
  // completed tours DO count (they occupied the slot)
  const all2 = [V, tour('done', '2026-07-20', '13:00', { status: 'completed' })];
  assert.deepEqual(await parallelIds(all2, V), ['done']);
});

test('scenario 7 — several tours are sorted chronologically ascending', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const all = [
    V,
    tour('t15', '2026-07-20', '14:30'),
    tour('t09', '2026-07-20', '09:30'),
    tour('t12', '2026-07-20', '12:00'),
    tour('t10', '2026-07-20', '10:15'),
  ];
  assert.deepEqual(await parallelIds(all, V), ['t09', 't10', 't12', 't15']);
});

test('scenario 8 — same product, different variants both appear', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const a = tour('a', '2026-07-20', '11:00', {
    product: { nameHe: 'סיור גרפיטי', nameEn: null },
    location: { nameHe: 'תל אביב' },
  });
  const b = tour('b', '2026-07-20', '13:00', {
    product: { nameHe: 'סיור גרפיטי', nameEn: null },
    location: { nameHe: 'ירושלים' },
  });
  const rows = await findParallelTours(fakeClient([V, a, b]), V);
  assert.deepEqual(rows.map((r) => r.variantName), ['סיור גרפיטי · תל אביב', 'סיור גרפיטי · ירושלים']);
});

test('scenario 9 — an unassigned tour yields empty staff', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const rows = await findParallelTours(fakeClient([V, tour('a', '2026-07-20', '12:30')]), V);
  assert.deepEqual(rows[0].staff, []);
});

test('scenario 10 — multiple assignments are deduped by name and role-ordered', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const a = tour('a', '2026-07-20', '12:30', {
    assignments: [
      { displayName: 'יואב', role: 'guide' },
      { displayName: 'דנה', role: 'lead_guide' },
      { displayName: 'יואב', role: 'workshop_assistant' }, // dup name, junior role
    ],
  });
  const rows = await findParallelTours(fakeClient([V, a]), V);
  assert.deepEqual(rows[0].staff, [
    { displayName: 'דנה', role: 'lead_guide' },
    { displayName: 'יואב', role: 'guide' },
  ]);
});

test('scenario 11 — participant count comes from the canonical activeSeats', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  const a = tour('a', '2026-07-20', '12:30');
  const rows = await findParallelTours(fakeClient([V, a], { a: 17 }), V);
  assert.equal(rows[0].participantCount, 17);
  // a tour with no registrations reports 0, never undefined
  const rows2 = await findParallelTours(fakeClient([V, a], {}), V);
  assert.equal(rows2[0].participantCount, 0);
});

test('scenario 12 — the viewed tour never includes itself', async () => {
  const V = tour('V', '2026-07-20', '12:00');
  assert.deepEqual(await parallelIds([V], V), []);
});

test('a postponed viewed tour (no date/time) has no window → empty', async () => {
  const V = tour('V', null, null, { status: 'postponed' });
  assert.deepEqual(await parallelIds([V, tour('a', '2026-07-20', '12:00')], V), []);
});

test('exported constants are the frozen business definition', () => {
  assert.equal(PARALLEL_WINDOW_MS, 3 * 60 * 60 * 1000);
  assert.deepEqual(PARALLEL_STATUSES, ['scheduled', 'completed']);
});
