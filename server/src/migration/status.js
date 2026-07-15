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
    latestRun,
  ] = await Promise.all([
    client.legacyRecord.count(),
    client.migrationDecision.count(),
    client.migrationRun.count(),
    client.migrationDecision.groupBy({ by: ['queue', 'status'], _count: true }),
    client.migrationRun.groupBy({ by: ['kind', 'status'], _count: true }),
    client.migrationRun.findFirst
      ? client.migrationRun.findFirst({ orderBy: { startedAt: 'desc' } })
      : null,
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
    // The most recent run's API usage + why it stopped — the operational view
    // that was missing when a run silently exhausted the Pipedrive daily budget.
    latestRun: summarizeRun(latestRun),
    phase: 'foundation',
    timestamp: new Date().toISOString(),
  };
}

// Secret-free summary of a MigrationRun row: what it is, how many Pipedrive
// requests it made against its ceiling, and the pause/failure reason.
function summarizeRun(run) {
  if (!run) return null;
  const counters = run.counters && typeof run.counters === 'object' ? run.counters : {};
  return {
    kind: run.kind,
    snapshotId: run.snapshotId ?? null,
    status: run.status,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    pipedriveRequests: counters._pipedriveRequests ?? null,
    pipedriveRequestLimit: counters._pipedriveRequestLimit ?? null,
    pauseReason: run.error ?? null,
    entityCounters: Object.fromEntries(Object.entries(counters).filter(([k]) => !k.startsWith('_'))),
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
