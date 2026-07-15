// Snapshot #1 status for the Review Center — derived from the real snapshot
// manifest in R2 plus the MigrationRun mirror. Read-only.
//
// Deliberately exposes ONLY safe summary facts: no credentials, no raw record
// payloads, no shard contents. Both `client` (prisma) and `r2` are injected so
// this is unit-testable without a database or a bucket.

export async function buildSnapshotStatus(client, r2) {
  const run = await client.migrationRun.findFirst({
    where: { kind: 'snapshot' },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.snapshotId) return null;

  const root = `snapshots/${run.snapshotId}`;
  const readJson = async (key) => {
    try { return JSON.parse(await r2.getObjectText(`${root}/${key}`)); } catch { return null; }
  };
  const manifest = await readJson('manifest.json');
  const verification = await readJson('_verification.json');

  // Object count + total size straight from the bucket (cheap: one listing).
  let objectCount = null, totalBytes = null;
  try {
    const objs = await r2.listKeys(`${root}/`);
    objectCount = objs.length;
    totalBytes = objs.reduce((n, o) => n + (Number(o.size) || 0), 0);
  } catch { /* storage listing is best-effort — the page still renders */ }

  const counters = run.counters && typeof run.counters === 'object' ? run.counters : {};

  return {
    snapshotId: run.snapshotId,
    status: manifest?.status || run.status,
    complete: (manifest?.status || run.status) === 'complete',
    createdAt: run.startedAt ?? manifest?.startedAt ?? null,
    finishedAt: run.finishedAt ?? manifest?.finishedAt ?? null,
    entityCount: manifest?.totals?.entities ?? null,
    recordCount: manifest?.totals?.records ?? null,
    objectCount,
    totalBytes,
    requests: {
      used: counters._pipedriveRequests ?? manifest?.requestBudget?.used ?? null,
      limit: counters._pipedriveRequestLimit ?? manifest?.requestBudget?.limit ?? null,
    },
    verification: verification
      ? {
          verdict: verification.verdict ?? null,
          verifiedAt: verification.verifiedAt ?? null,
          blocking: verification.blockingCount ?? (verification.blocking?.length ?? null),
          warnings: verification.warningCount ?? (verification.warnings?.length ?? null),
          checks: verification.checks ?? null,
        }
      : null,
    // Plain-language scope notes recorded by the run itself.
    scope: manifest?.scope ?? null,
  };
}
