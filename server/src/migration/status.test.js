import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMigrationStatus } from './status.js';

// A minimal prisma stub — buildMigrationStatus takes the client as an argument
// precisely so it can be verified with no database.
function stubClient({ legacy = 0, decisions = 0, runs = 0, decisionGroups = [], runGroups = [] }) {
  return {
    legacyRecord: { count: async () => legacy },
    migrationDecision: {
      count: async () => decisions,
      groupBy: async () => decisionGroups,
    },
    migrationRun: {
      count: async () => runs,
      groupBy: async () => runGroups,
    },
  };
}

test('empty initial state → all zeros, foundation phase, no groups', async () => {
  const s = await buildMigrationStatus(stubClient({}));
  assert.equal(s.tables.legacyRecords, 0);
  assert.equal(s.tables.migrationDecisions, 0);
  assert.equal(s.tables.migrationRuns, 0);
  assert.deepEqual(s.decisionsByQueue, {});
  assert.deepEqual(s.runsByKind, {});
  assert.equal(s.phase, 'foundation');
  assert.ok(s.config); // config readiness always present
  assert.ok(typeof s.timestamp === 'string');
});

test('folds decision groups by queue → status → count (numeric _count)', async () => {
  const s = await buildMigrationStatus(
    stubClient({
      decisions: 5,
      decisionGroups: [
        { queue: 'org_dedup', status: 'pending', _count: 3 },
        { queue: 'org_dedup', status: 'approved', _count: 1 },
        { queue: 'name_cleanup', status: 'pending', _count: 1 },
      ],
    }),
  );
  assert.deepEqual(s.decisionsByQueue, {
    org_dedup: { pending: 3, approved: 1 },
    name_cleanup: { pending: 1 },
  });
});

test('folds run groups by kind → status (object _count shape)', async () => {
  const s = await buildMigrationStatus(
    stubClient({
      runs: 2,
      runGroups: [
        { kind: 'snapshot', status: 'done', _count: { _all: 1 } },
        { kind: 'extract', status: 'running', _count: { _all: 1 } },
      ],
    }),
  );
  assert.deepEqual(s.runsByKind, {
    snapshot: { done: 1 },
    extract: { running: 1 },
  });
});
