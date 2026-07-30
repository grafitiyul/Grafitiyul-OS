// Phase C — drain the buffered window through the canonical pipeline.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/run-replay.mjs [--execute]
//
// Dry (default): counts what WOULD be replayed. Execute: processes every pending
// event in receivedAt order with apply permitted for this operation only — the
// global MIRROR_APPLY_ENABLED stays off until Phase D is switched on explicitly.
import { PrismaClient } from '@prisma/client';
import { replayBufferedWindow, verifyNoBlindWindow } from '../../src/mirror/replay.js';
import { mirrorAdapterFactory, warmMirrorAdapters } from '../../src/mirror/adapters.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
await warmMirrorAdapters();

// The blind-window proof, always — replay means nothing if capture started late.
const SNAPSHOT_AT = '2026-07-30T08:17:31Z'; // snap-20260730T081731Z-44cb
const blind = await verifyNoBlindWindow(prisma, { snapshotTakenAt: SNAPSHOT_AT });
for (const f of blind.findings ?? blind) {
  console.log(`${f.ok ? '✓' : '✗'} ${f.system}: capture ${f.captureStartedAt ?? '-'} vs snapshot ${f.snapshotTakenAt ?? SNAPSHOT_AT}${f.problem ? ` — ${f.problem}` : ''}`);
}

const pending = await prisma.mirrorEvent.count({ where: { status: 'pending' } });
console.log(`\npending events: ${pending}`);

const res = await replayBufferedWindow(prisma, mirrorAdapterFactory, {
  dryRun: !EXECUTE,
  onProgress: ({ done, total }) => console.log(`  …${done}/${total}`),
});

console.log(`\n${EXECUTE ? 'REPLAY RESULT' : 'DRY RUN'}`);
console.log(JSON.stringify(res, null, 2));

if (EXECUTE) {
  const after = await prisma.mirrorEvent.groupBy({ by: ['status'], _count: { _all: true } });
  console.log(`\nevent statuses after replay: ${JSON.stringify(after.map((x) => `${x.status}=${x._count._all}`))}`);
  const reasons = await prisma.mirrorEvent.groupBy({ by: ['failureCode'], _count: { _all: true }, where: { status: 'pending' } });
  console.log(`still-pending reasons: ${JSON.stringify(reasons.map((x) => `${x.failureCode ?? '(fresh)'}=${x._count._all}`))}`);
}
await prisma.$disconnect();
