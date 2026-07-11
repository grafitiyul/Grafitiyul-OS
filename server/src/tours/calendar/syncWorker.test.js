import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTour, processTombstone, sweepUnsyncedTours } from './syncWorker.js';
import { buildDesiredEvent, wallTimeToEpoch } from './desiredState.js';

// The reconciler with injected fakes: db (prisma-shaped) + cal (Google client
// shaped). Verifies the convergence rules — insert/patch/delete decisions and
// the outbox state transitions — without any network or database.

const ACCOUNT = { id: 'acc1' };

function makeTour(overrides = {}) {
  return {
    id: 'tour1',
    status: 'scheduled',
    date: '2026-07-20',
    startTime: '10:00',
    tourLanguage: 'he',
    gcalEventId: null,
    gcalAccountId: null,
    gcalSyncStatus: 'pending',
    gcalAttempts: 0,
    gcalLastSummary: null,
    gcalLastDescription: null,
    gcalLastColorId: null,
    updatedAt: new Date('2026-07-11T08:00:00Z'),
    product: { nameHe: 'סיור גרפיטי', nameEn: 'Graffiti Tour' },
    productVariant: { durationHours: 2 },
    location: null,
    assignments: [{ displayName: 'דנה', personRef: { email: 'dana@x.com' } }],
    activityComponents: [],
    ...overrides,
  };
}

// Baselines matching a tour that was already fully GOS-synced once.
function syncedBaselines(tour) {
  const { event } = buildDesiredEvent(tour);
  return {
    gcalLastSummary: event.summary,
    gcalLastDescription: event.description,
    gcalLastColorId: event.colorId,
  };
}

// prisma-shaped fake: findUnique returns `tour`; updateMany captures writes and
// honours the optimistic updatedAt guard.
function makeDb(tour, { concurrentBump = false } = {}) {
  const writes = [];
  return {
    writes,
    tourEvent: {
      findUnique: async () => tour,
      updateMany: async ({ where, data }) => {
        writes.push({ where, data });
        if (where.updatedAt && concurrentBump) return { count: 0 };
        return { count: 1 };
      },
    },
    tourCalendarTombstone: {
      update: async ({ where, data }) => {
        writes.push({ where, data });
        return {};
      },
    },
  };
}

function makeCal(overrides = {}) {
  const calls = [];
  const record =
    (name, impl) =>
    async (...args) => {
      calls.push({ name, args: args.slice(2) });
      return impl ? impl(...args) : undefined;
    };
  return {
    calls,
    getEvent: record('getEvent', overrides.getEvent),
    insertEvent: record('insertEvent', overrides.insertEvent || (() => ({ id: 'ev-new' }))),
    patchEvent: record('patchEvent', overrides.patchEvent || ((c, a, id) => ({ id }))),
    deleteEvent: record('deleteEvent', overrides.deleteEvent),
    findByTourEventId: record('findByTourEventId', overrides.findByTourEventId || (() => null)),
  };
}

const gone = () => {
  const e = new Error('gone');
  e.status = 404;
  throw e;
};

test('scheduled tour without an event → insert + synced with event id', async () => {
  const tour = makeTour();
  const db = makeDb(tour);
  const cal = makeCal();
  const res = await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  assert.equal(res, 'synced');
  assert.deepEqual(cal.calls.map((c) => c.name), ['findByTourEventId', 'insertEvent']);
  const w = db.writes.at(-1);
  assert.equal(w.data.gcalEventId, 'ev-new');
  assert.equal(w.data.gcalAccountId, 'acc1');
  assert.equal(w.data.gcalSyncStatus, 'synced');
  assert.equal(w.data.gcalSyncError, null);
  // Presentation baselines recorded at insert — the write-echo that later
  // distinguishes GOS-owned values from manual Google edits.
  assert.match(w.data.gcalLastSummary, /סיור גרפיטי \| 20\.07\.2026 \| 10:00/);
  assert.equal(w.data.gcalLastColorId, '6');
});

test('cancelled tour with an event → delete + id cleared (restore creates anew)', async () => {
  const tour = makeTour({ status: 'cancelled', gcalEventId: 'ev1' });
  const db = makeDb(tour);
  const cal = makeCal();
  const res = await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  assert.equal(res, 'synced');
  assert.deepEqual(cal.calls.map((c) => c.name), ['deleteEvent']);
  const w = db.writes.at(-1);
  assert.equal(w.data.gcalEventId, null);
  assert.equal(w.data.gcalSyncStatus, 'synced');
});

test('cancelled tour whose event is already gone on Google → still synced', async () => {
  const tour = makeTour({ status: 'cancelled', gcalEventId: 'ev1' });
  const db = makeDb(tour);
  const cal = makeCal({ deleteEvent: gone });
  assert.equal(await reconcileTour({ db, cal }, ACCOUNT, tour.id), 'synced');
});

test('completed tour → calendar untouched (history is never cancelled)', async () => {
  const tour = makeTour({ status: 'completed', gcalEventId: 'ev1' });
  const db = makeDb(tour);
  const cal = makeCal();
  const res = await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  assert.equal(res, 'synced');
  assert.equal(cal.calls.length, 0);
});

test('existing event already matching → GET only, no write to Google', async () => {
  const base = makeTour({ gcalEventId: 'ev1' });
  const tour = { ...base, ...syncedBaselines(base) };
  const { event: desired } = buildDesiredEvent(tour);
  const googleSide = {
    id: 'ev1',
    status: 'confirmed',
    summary: desired.summary,
    description: desired.description,
    colorId: desired.colorId,
    location: desired.location,
    start: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '10:00')).toISOString() },
    end: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '12:00')).toISOString() },
    attendees: [{ email: 'dana@x.com', responseStatus: 'accepted' }],
    extendedProperties: desired.extendedProperties,
  };
  const db = makeDb(tour);
  const cal = makeCal({ getEvent: () => googleSide });
  const res = await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  assert.equal(res, 'synced');
  assert.deepEqual(cal.calls.map((c) => c.name), ['getEvent']);
});

test('existing event with drift → minimal patch', async () => {
  const tour = makeTour({ gcalEventId: 'ev1' });
  const db = makeDb(tour);
  const cal = makeCal({
    getEvent: () => ({
      id: 'ev1',
      status: 'confirmed',
      summary: 'כותרת ישנה',
      start: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '10:00')).toISOString() },
      end: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '12:00')).toISOString() },
      attendees: [{ email: 'dana@x.com' }],
      extendedProperties: { private: { gosTourEventId: 'tour1' } },
    }),
  });
  await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  const patchCall = cal.calls.find((c) => c.name === 'patchEvent');
  assert.ok(patchCall);
  // No stored baseline (legacy row) → GOS adopts title + color to the new
  // derived defaults.
  assert.equal(patchCall.args[1].summary, 'סיור גרפיטי | 20.07.2026 | 10:00');
  assert.equal(patchCall.args[1].colorId, '6');
});

test('manual Google title survives an operational change (worker path)', async () => {
  const base = makeTour({ gcalEventId: 'ev1' });
  const tour = { ...base, ...syncedBaselines(base) };
  const { event: desired } = buildDesiredEvent(tour);
  const db = makeDb(tour);
  const cal = makeCal({
    getEvent: () => ({
      id: 'ev1',
      status: 'confirmed',
      summary: 'כותרת שהמפעיל שינה ביד', // differs from the stored baseline
      description: desired.description,
      colorId: desired.colorId,
      location: desired.location,
      start: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '10:00')).toISOString() },
      end: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '12:00')).toISOString() },
      attendees: [], // guide was added in GOS → attendees must converge
      extendedProperties: desired.extendedProperties,
    }),
  });
  await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  const patchCall = cal.calls.find((c) => c.name === 'patchEvent');
  assert.ok(patchCall);
  assert.deepEqual(patchCall.args[1].attendees, [{ email: 'dana@x.com' }]);
  assert.equal(patchCall.args[1].summary, undefined); // manual title preserved
  // Baseline stays the OLD GOS value so a manual revert restores ownership.
  assert.equal(db.writes.at(-1).data.gcalLastSummary, tour.gcalLastSummary);
});

test('event deleted on Google side → adopt-or-recreate path', async () => {
  const tour = makeTour({ gcalEventId: 'ev1' });
  const db = makeDb(tour);
  const cal = makeCal({ getEvent: gone });
  await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  assert.deepEqual(
    cal.calls.map((c) => c.name),
    ['getEvent', 'findByTourEventId', 'insertEvent'],
  );
  assert.equal(db.writes.at(-1).data.gcalEventId, 'ev-new');
});

test('lost-id insert is adopted via the gosTourEventId stamp (no duplicate event)', async () => {
  const tour = makeTour();
  const { event: desired } = buildDesiredEvent(tour);
  const db = makeDb(tour);
  const cal = makeCal({
    findByTourEventId: () => ({
      id: 'ev-lost',
      status: 'confirmed',
      summary: desired.summary,
      description: desired.description,
      colorId: desired.colorId,
      location: desired.location,
      start: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '10:00')).toISOString() },
      end: { dateTime: new Date(wallTimeToEpoch('2026-07-20', '12:00')).toISOString() },
      attendees: [{ email: 'dana@x.com' }],
      extendedProperties: desired.extendedProperties,
    }),
  });
  const res = await reconcileTour({ db, cal }, ACCOUNT, tour.id);
  assert.equal(res, 'synced');
  assert.ok(!cal.calls.some((c) => c.name === 'insertEvent'));
  assert.equal(db.writes.at(-1).data.gcalEventId, 'ev-lost');
});

test('google failure → stays pending with backoff; attempts exhaust to failed', async () => {
  const boom = () => {
    throw new Error('rate limited');
  };
  const first = makeTour();
  const db1 = makeDb(first);
  await reconcileTour({ db: db1, cal: makeCal({ findByTourEventId: boom }) }, ACCOUNT, first.id);
  const w1 = db1.writes.at(-1);
  assert.equal(w1.data.gcalSyncStatus, 'pending');
  assert.equal(w1.data.gcalAttempts, 1);
  assert.ok(w1.data.gcalNextRetryAt > new Date());

  const last = makeTour({ gcalAttempts: 7 });
  const db2 = makeDb(last);
  await reconcileTour({ db: db2, cal: makeCal({ findByTourEventId: boom }) }, ACCOUNT, last.id);
  const w2 = db2.writes.at(-1);
  assert.equal(w2.data.gcalSyncStatus, 'failed');
  assert.match(w2.data.gcalSyncError, /rate limited/);
});

test('concurrent mutation during sync → row stays pending (requeued)', async () => {
  const tour = makeTour();
  const db = makeDb(tour, { concurrentBump: true });
  const res = await reconcileTour({ db, cal: makeCal() }, ACCOUNT, tour.id);
  assert.equal(res, 'requeued');
});

test('missing-email warning is persisted on an otherwise-successful sync', async () => {
  const tour = makeTour({
    assignments: [
      { displayName: 'בלי מייל', personRef: { email: null } },
      { displayName: 'דנה', personRef: { email: 'dana@x.com' } },
    ],
  });
  const db = makeDb(tour);
  await reconcileTour({ db, cal: makeCal() }, ACCOUNT, tour.id);
  const w = db.writes.at(-1);
  assert.equal(w.data.gcalSyncStatus, 'synced');
  assert.match(w.data.gcalSyncWarning, /בלי מייל/);
});

test('tour no longer pending (already synced) → skipped, no API calls', async () => {
  const tour = makeTour({ gcalSyncStatus: 'synced' });
  const cal = makeCal();
  const res = await reconcileTour({ db: makeDb(tour), cal }, ACCOUNT, tour.id);
  assert.equal(res, 'skipped');
  assert.equal(cal.calls.length, 0);
});

test('tombstone: delete succeeds (or event already gone) → done', async () => {
  const stone = { id: 's1', gcalEventId: 'ev1', attempts: 0 };
  const dbOk = makeDb(null);
  assert.equal(await processTombstone({ db: dbOk, cal: makeCal() }, ACCOUNT, stone), 'done');
  assert.equal(dbOk.writes.at(-1).data.status, 'done');

  const dbGone = makeDb(null);
  assert.equal(
    await processTombstone({ db: dbGone, cal: makeCal({ deleteEvent: gone }) }, ACCOUNT, stone),
    'done',
  );
});

test('sweep marks only never-considered scheduled future tours', async () => {
  let captured;
  const db = {
    tourEvent: {
      updateMany: async ({ where, data }) => {
        captured = { where, data };
        return { count: 3 };
      },
    },
  };
  const count = await sweepUnsyncedTours(db);
  assert.equal(count, 3);
  assert.equal(captured.where.gcalSyncStatus, null);
  assert.equal(captured.where.status, 'scheduled');
  assert.ok(captured.where.date.gte); // today (Asia/Jerusalem) — past stays NULL
  assert.equal(captured.data.gcalSyncStatus, 'pending');
});
