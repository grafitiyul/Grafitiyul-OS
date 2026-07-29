import test from 'node:test';
import assert from 'node:assert/strict';
import { apiCeiling, applyEnabled, captureEnabled, mirrorMode, pollIntervalMs } from './config.js';
import { baselineCoverage, baselineFromSource, seedBaselines } from './seedBaseline.js';
import { replayBufferedWindow, replayResidue, verifyNoBlindWindow } from './replay.js';

const env = (o = {}) => ({ ...o });

// ── the two switches ─────────────────────────────────────────────────────────

test('both switches default OFF', () => {
  assert.equal(captureEnabled(env()), false);
  assert.equal(applyEnabled(env()), false);
  const m = mirrorMode(env());
  assert.equal(m.capture, false);
  assert.equal(m.apply, false);
});

test('Phase A is expressible: capture on, apply off', () => {
  const m = mirrorMode(env({ MIRROR_CAPTURE_ENABLED: 'true' }));
  assert.equal(m.capture, true);
  assert.equal(m.apply, false);
  assert.equal(m.incoherent, false);
});

test('apply WITHOUT capture is flagged incoherent — it would write then go blind', () => {
  const m = mirrorMode(env({ MIRROR_APPLY_ENABLED: 'true' }));
  assert.equal(m.incoherent, true);
});

test('the legacy single flag still turns both on rather than silently going dark', () => {
  const m = mirrorMode(env({ MIRROR_ENABLED: 'true' }));
  assert.equal(m.capture, true);
  assert.equal(m.apply, true);
  assert.equal(m.legacy, true);
});

test('poll interval has a 30s floor and a 5-minute default', () => {
  assert.equal(pollIntervalMs(env()), 300_000);
  assert.equal(pollIntervalMs(env({ MIRROR_POLL_INTERVAL_MS: '1000' })), 300_000, 'a too-tight interval is refused');
  assert.equal(pollIntervalMs(env({ MIRROR_POLL_INTERVAL_MS: '60000' })), 60_000);
});

test('an API ceiling always exists, so a bug cannot exhaust quota', () => {
  assert.equal(apiCeiling(env()), 500);
  assert.equal(apiCeiling(env({ MIRROR_MAX_API_CALLS_PER_RUN: '50' })), 50);
  assert.equal(apiCeiling(env({ MIRROR_MAX_API_CALLS_PER_RUN: 'nonsense' })), 500);
  assert.equal(apiCeiling(env({ MIRROR_MAX_API_CALLS_PER_RUN: '-5' })), 500);
});

// ── baseline seeding ─────────────────────────────────────────────────────────

test('only mirror-writable fields are seeded', () => {
  const b = baselineFromSource('deal', {
    title: 'A', status: 'open', orderNo: 27000, notes: 'gos-owned', productId: 'p1',
  });
  assert.deepEqual(Object.keys(b).sort(), ['status', 'title']);
});

test('dates and BigInt are serialized JSON-safe (the baseline lives in JSONB)', () => {
  const b = baselineFromSource('deal', { wonAt: new Date('2026-07-29T10:00:00Z'), valueMinor: 531000n });
  assert.equal(b.wonAt, '2026-07-29T10:00:00.000Z');
  assert.equal(b.valueMinor, '531000');
});

function seedDb(records) {
  const rows = records.map((r) => ({ ...r }));
  return {
    rows,
    legacyRecord: {
      findMany: async ({ where }) => rows.filter((r) => where.sourceId.in.includes(r.sourceId)),
      count: async ({ where }) => rows.filter((r) => (
        (!where.entityId || r.entityId !== null)
        && (!where.syncBaseline || r.syncBaseline !== null)
      )).length,
      update: async ({ where, data }) => {
        const r = rows.find((x) => x.sourceId === where.sourceSystem_sourceType_sourceId.sourceId);
        Object.assign(r, data); return r;
      },
    },
  };
}

test('seeding fills baselines for crosswalked records', async () => {
  const db = seedDb([
    { sourceId: '1', entityId: 'd1', syncBaseline: null },
    { sourceId: '2', entityId: 'd2', syncBaseline: null },
  ]);
  const s = await seedBaselines(db, {
    system: 'pipedrive', sourceType: 'deal', entity: 'deal',
    rows: [{ sourceId: '1', fields: { title: 'A' } }, { sourceId: '2', fields: { title: 'B' } }],
  });
  assert.equal(s.seeded, 2);
  assert.equal(db.rows[0].syncBaseline.title, 'A');
});

test('seeding NEVER rewinds a baseline the live mirror already advanced', async () => {
  const db = seedDb([{ sourceId: '1', entityId: 'd1', syncBaseline: { title: 'ADVANCED' } }]);
  const s = await seedBaselines(db, {
    system: 'pipedrive', sourceType: 'deal', entity: 'deal',
    rows: [{ sourceId: '1', fields: { title: 'SNAPSHOT' } }],
  });
  assert.equal(s.skippedExisting, 1);
  assert.equal(s.seeded, 0);
  assert.equal(db.rows[0].syncBaseline.title, 'ADVANCED');
});

test('a record with no crosswalk is skipped, never invented', async () => {
  const db = seedDb([{ sourceId: '1', entityId: null, syncBaseline: null }]);
  const s = await seedBaselines(db, {
    system: 'pipedrive', sourceType: 'deal', entity: 'deal',
    rows: [{ sourceId: '1', fields: { title: 'A' } }, { sourceId: '999', fields: { title: 'X' } }],
  });
  assert.equal(s.skippedNoCrosswalk, 2);
  assert.equal(s.seeded, 0);
});

test('seeding is idempotent', async () => {
  const db = seedDb([{ sourceId: '1', entityId: 'd1', syncBaseline: null }]);
  const args = { system: 'pipedrive', sourceType: 'deal', entity: 'deal', rows: [{ sourceId: '1', fields: { title: 'A' } }] };
  await seedBaselines(db, args);
  const second = await seedBaselines(db, args);
  assert.equal(second.seeded, 0);
  assert.equal(second.skippedExisting, 1);
});

test('coverage counts records whose next change would be SILENTLY swallowed', async () => {
  const db = seedDb([
    { sourceId: '1', entityId: 'd1', syncBaseline: { title: 'A' } },
    { sourceId: '2', entityId: 'd2', syncBaseline: null },
  ]);
  const c = await baselineCoverage(db, { system: 'pipedrive', sourceType: 'deal' });
  assert.equal(c.total, 2);
  assert.equal(c.seeded, 1);
  assert.equal(c.missing, 1);
  assert.equal(c.atRiskOfSilentBootstrap, 1);
  assert.equal(c.complete, false);
});

// ── replay ───────────────────────────────────────────────────────────────────

function replayDb(events) {
  const rows = events.map((e, i) => ({ id: `e${i}`, status: 'pending', ...e }));
  const applied = [];
  return {
    rows, applied,
    mirrorEvent: {
      findMany: async ({ where, take }) => rows
        .filter((r) => r.status === (where.status || r.status)
          && (!where.system || r.system === where.system)
          && (!where.entity || r.entity === where.entity))
        .sort((a, b) => a.receivedAt - b.receivedAt).slice(0, take),
      count: async ({ where }) => rows.filter((r) => r.status === where.status).length,
      findFirst: async ({ where, orderBy }) => rows
        .filter((r) => !where.system || r.system === where.system)
        .sort((a, b) => (orderBy?.receivedAt === 'asc' ? a.receivedAt - b.receivedAt : b.receivedAt - a.receivedAt))[0] || null,
    },
  };
}

test('replay processes in receivedAt order, oldest first', async () => {
  const db = replayDb([
    { system: 'pipedrive', entity: 'deal', externalId: '1', receivedAt: new Date('2026-07-29T12:00:00Z') },
    { system: 'pipedrive', entity: 'deal', externalId: '2', receivedAt: new Date('2026-07-29T10:00:00Z') },
  ]);
  const order = [];
  const { replayBufferedWindow: run } = await import('./replay.js');
  // Stub processEvent by intercepting through the adapter factory contract:
  // the runner calls processEvent(db, id, adapter, {allowApply:true}).
  db.mirrorEvent.findUnique = async ({ where }) => db.rows.find((r) => r.id === where.id);
  db.mirrorEvent.update = async ({ where, data }) => {
    const r = db.rows.find((x) => x.id === where.id);
    Object.assign(r, data);
    order.push(r.externalId);
    return r;
  };
  const stats = await run(db, () => ({
    sourceType: 'deal',
    normalize: async () => ({ fields: {} }),
    loadGos: async () => ({ id: 'd1' }),
    applyGos: async () => {},
  }));
  assert.equal(stats.total, 2);
  assert.deepEqual(order.slice(0, 2), ['2', '1'], 'oldest replayed first');
});

test('a dry run touches nothing', async () => {
  const db = replayDb([{ system: 'pipedrive', entity: 'deal', externalId: '1', receivedAt: new Date() }]);
  const stats = await replayBufferedWindow(db, () => ({}), { dryRun: true });
  assert.equal(stats.dryRun, true);
  assert.equal(stats.total, 1);
  assert.equal(stats.applied, 0);
});

// ── blind-window proof ───────────────────────────────────────────────────────

test('capture BEFORE the snapshot proves no blind window', async () => {
  const db = replayDb([
    { system: 'pipedrive', entity: 'deal', receivedAt: new Date('2026-07-29T09:00:00Z') },
    { system: 'airtable', entity: 'tourEvent', receivedAt: new Date('2026-07-29T09:30:00Z') },
  ]);
  const r = await verifyNoBlindWindow(db, { snapshotTakenAt: '2026-07-29T12:00:00Z' });
  assert.equal(r.ok, true);
  assert.match(r.findings[0].detail, /before the snapshot/);
});

test('capture AFTER the snapshot is caught as a blind window', async () => {
  const db = replayDb([{ system: 'pipedrive', entity: 'deal', receivedAt: new Date('2026-07-29T13:00:00Z') }]);
  const r = await verifyNoBlindWindow(db, { snapshotTakenAt: '2026-07-29T12:00:00Z', systems: ['pipedrive'] });
  assert.equal(r.ok, false);
  assert.equal(r.findings[0].problem, 'blind_window');
  assert.match(r.findings[0].detail, /60 min AFTER/);
});

test('a source with NO capture at all is caught', async () => {
  const db = replayDb([{ system: 'pipedrive', entity: 'deal', receivedAt: new Date('2026-07-29T09:00:00Z') }]);
  const r = await verifyNoBlindWindow(db, { snapshotTakenAt: '2026-07-29T12:00:00Z' });
  assert.equal(r.ok, false);
  const at = r.findings.find((f) => f.system === 'airtable');
  assert.equal(at.problem, 'no_capture');
});

test('residue check: nothing may be unapplied when apply goes live', async () => {
  const clean = replayDb([{ system: 'pipedrive', entity: 'deal', receivedAt: new Date(), status: 'processed' }]);
  clean.rows[0].status = 'processed';
  assert.equal((await replayResidue(clean)).clean, true);

  const dirty = replayDb([{ system: 'pipedrive', entity: 'deal', receivedAt: new Date() }]);
  const res = await replayResidue(dirty);
  assert.equal(res.clean, false);
  assert.equal(res.pending, 1);
});
