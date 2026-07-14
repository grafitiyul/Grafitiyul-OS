// Legacy-migration status/observability (Slice 1).
//
// buildMigrationStatus(client) returns a secret-free snapshot of the migration
// infrastructure: config readiness + row counts across the three tables, grouped
// by the dimensions that matter (decisions by queue+status, runs by kind+status).
// Takes the prisma client as an argument so it is unit-testable with a stub and
// has no hidden module-level dependency.

import { migrationConfigStatus } from './config.js';

export async function buildMigrationStatus(client) {
  const [
    legacyRecords,
    migrationDecisions,
    migrationRuns,
    decisionGroups,
    runGroups,
  ] = await Promise.all([
    client.legacyRecord.count(),
    client.migrationDecision.count(),
    client.migrationRun.count(),
    client.migrationDecision.groupBy({ by: ['queue', 'status'], _count: true }),
    client.migrationRun.groupBy({ by: ['kind', 'status'], _count: true }),
  ]);

  return {
    config: migrationConfigStatus(),
    tables: {
      legacyRecords,
      migrationDecisions,
      migrationRuns,
    },
    decisionsByQueue: foldGroups(decisionGroups, 'queue'),
    runsByKind: foldGroups(runGroups, 'kind'),
    // Slice 1 is infrastructure only — nothing has run or been written yet.
    phase: 'foundation',
    timestamp: new Date().toISOString(),
  };
}

// [{ <dimKey>: 'x', status: 'pending', _count: n }] → { x: { pending: n, … } }.
// Handles Prisma's _count being either a number or an object shape.
function foldGroups(groups, dimKey) {
  const out = {};
  for (const g of groups || []) {
    const key = g[dimKey];
    const n = typeof g._count === 'number' ? g._count : g._count?._all ?? 0;
    out[key] = out[key] || {};
    out[key][g.status] = n;
  }
  return out;
}
