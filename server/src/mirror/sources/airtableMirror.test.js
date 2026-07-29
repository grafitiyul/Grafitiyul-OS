import test from 'node:test';
import assert from 'node:assert/strict';
import { CANCELLED_STATES, airtableTourSource, hhmm, mapStatus, tourAdapter } from './airtableMirror.js';

const A = tourAdapter();
const rec = (fields, over = {}) => ({ id: 'recX', fields, lastModified: '2026-07-29T10:00:00.000Z', ...over });

// ── translation ──────────────────────────────────────────────────────────────

test('the Hebrew status vocabulary maps to GOS states', () => {
  assert.equal(mapStatus('מבוטל'), 'cancelled');
  assert.equal(mapStatus('בוטל'), 'cancelled');
  assert.equal(mapStatus('הושלם'), 'completed');
  assert.equal(mapStatus('מתוכנן'), 'scheduled');
  assert.equal(mapStatus('נדחה'), 'postponed');
});

test('an UNKNOWN status maps to null and is therefore not offered', async () => {
  assert.equal(mapStatus('משהו חדש'), null);
  const n = await A.normalize(rec({ DATE: '2026-08-01', 'סטטוס': 'משהו חדש' }));
  assert.equal('status' in n.fields, false, 'an unknown status must never overwrite a real one');
});

test('times are normalised to HH:MM from several shapes', () => {
  assert.equal(hhmm('9:30'), '09:30');
  assert.equal(hhmm('2026-08-01T14:05:00.000Z'), '14:05');
  assert.equal(hhmm('nonsense'), null);
  assert.equal(hhmm(null), null);
});

test('Airtable single-element arrays are unwrapped', async () => {
  const n = await A.normalize(rec({ DATE: ['2026-08-01'], 'סטטוס': ['הושלם'] }));
  assert.equal(n.fields.date, '2026-08-01');
  assert.equal(n.fields.status, 'completed');
});

// ── the date gate ────────────────────────────────────────────────────────────

test('DATE GATE: an unusable date is never guessed at and never silently dropped', async () => {
  for (const bad of ['', 'not a date', '2026-02-30', { error: '#REF' }]) {
    const n = await A.normalize(rec({ DATE: bad, 'סטטוס': 'מתוכנן' }));
    assert.equal('date' in n.fields, false, `date offered for ${JSON.stringify(bad)}`);
    assert.ok(n.dateRejected, 'the rejection is reported, not swallowed');
  }
});

test('a valid date IS offered and the rejection is null', async () => {
  const n = await A.normalize(rec({ DATE: '2026-08-01' }));
  assert.equal(n.fields.date, '2026-08-01');
  assert.equal(n.dateRejected, null);
});

test('a rejected date does not block the other fields', async () => {
  const n = await A.normalize(rec({ DATE: 'rubbish', 'סטטוס': 'הושלם', 'שעת התחלה': '10:00' }));
  assert.equal(n.fields.status, 'completed');
  assert.equal(n.fields.startTime, '10:00');
});

// ── LAW 2 ────────────────────────────────────────────────────────────────────

function tourDb(row) {
  const t = { ...row };
  return {
    _row: t,
    tourEvent: {
      findUnique: async () => ({ ...t }),
      update: async ({ data }) => { Object.assign(t, data); return t; },
    },
  };
}

test('LAW 2: a cancelled tour is NEVER revived, even if the source says scheduled', async () => {
  const db = tourDb({ id: 't1', status: 'cancelled', capacity: 10 });
  await A.applyGos(db, 't1', { status: 'scheduled', capacity: 25 });
  assert.equal(db._row.status, 'cancelled', 'the cancellation stands');
  assert.equal(db._row.capacity, 25, 'but other fields still merge');
});

test('LAW 2 allows the cancelling direction', async () => {
  const db = tourDb({ id: 't1', status: 'scheduled' });
  await A.applyGos(db, 't1', { status: 'cancelled' });
  assert.equal(db._row.status, 'cancelled');
});

test('a cancelled tour whose only change is the revival writes NOTHING', async () => {
  const db = tourDb({ id: 't1', status: 'cancelled' });
  let updated = false;
  db.tourEvent.update = async () => { updated = true; };
  await A.applyGos(db, 't1', { status: 'completed' });
  assert.equal(updated, false, 'no pointless empty update');
});

test('CANCELLED_STATES is the single source of that judgement', () => {
  assert.deepEqual([...CANCELLED_STATES], ['cancelled']);
});

// ── poller source ────────────────────────────────────────────────────────────

test('the poll source carries lastModified as the version marker', async () => {
  const client = {
    listModifiedSince: async (cursor) => ({
      records: [rec({ DATE: '2026-08-01' }), rec({ DATE: '2026-08-02' }, { id: 'recY', lastModified: '2026-07-29T11:00:00.000Z' })],
      nextCursor: '2026-07-29T11:00:00.000Z',
      seen: cursor,
    }),
  };
  const src = airtableTourSource(client);
  const out = await src.fetchChanges('2026-07-28T00:00:00.000Z');
  assert.equal(out.records.length, 2);
  assert.equal(out.records[0].externalId, 'recX');
  assert.equal(out.records[0].version, '2026-07-29T10:00:00.000Z');
  assert.equal(out.nextCursor, '2026-07-29T11:00:00.000Z');
});

test('without lastModified the version is null, so the pipeline hashes the payload', async () => {
  const client = { listModifiedSince: async () => ({ records: [rec({ DATE: '2026-08-01' }, { lastModified: null })], nextCursor: null }) };
  const out = await airtableTourSource(client).fetchChanges(null);
  assert.equal(out.records[0].version, null);
});

test('a deleted record normalises to a source deletion, never an update', async () => {
  const n = await A.normalize({ id: 'recX', deleted: true });
  assert.equal(n.sourceDeleted, true);
  assert.deepEqual(n.fields, {});
});

// ── ownership boundary ───────────────────────────────────────────────────────

test('the adapter only ever loads the mirrored field set — never payroll or calendar state', async () => {
  let selected = null;
  const db = { tourEvent: { findUnique: async ({ select }) => { selected = select; return {}; } } };
  await A.loadGos(db, 't1');
  const keys = Object.keys(selected);
  for (const forbidden of ['completedReason', 'completedAt', 'gcalEventId', 'gcalSyncStatus', 'wooSyncStatus', 'openTourTemplateId']) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must not even be read into the merge`);
  }
});
