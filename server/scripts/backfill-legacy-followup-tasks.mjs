// ONE-TIME historical backfill: give every OPEN deal a canonical GOS follow-up
// task, so the Tasks workspace stops being blind to the migrated book.
//
//   node scripts/backfill-legacy-followup-tasks.mjs          # dry run (default)
//   node scripts/backfill-legacy-followup-tasks.mjs --apply  # write
//
// WHY IT EXISTS
// The nightly recovery (tasks/autoTaskWorker.js) treats ANY open task as proof
// the deal is being worked. After the Pipedrive migration, hundreds of open
// deals carry an open task that was IMPORTED — history, not a live GOS task —
// so the nightly sweep correctly stood down and those deals never received a
// canonical follow-up. They are absent from today's Tasks module.
//
// WHAT IT DOES NOT DO
//   • it does not change the nightly automation — this runs the SAME
//     runMissingTaskSweep, with `excludeLegacyTasks` flipped on for this run
//     only. No business logic is reimplemented here;
//   • it never modifies, converts, closes or deletes an imported task. Legacy
//     tasks stay in history exactly as they are; they simply stop counting as
//     a live follow-up.
//
// IDEMPOTENT: the sweep's own per-(deal, day) guard means a second run creates
// zero tasks — the follow-up written by the first run blocks it, in ANY status.
//
// Realtime note: this is a separate process, so the tasks.changed SSE hint is a
// no-op. Open Tasks screens pick the new rows up on their next fetch/refresh.

import { PrismaClient } from '@prisma/client';
import { runMissingTaskSweep, FOLLOW_UP_TITLE } from '../src/tasks/autoTasks.js';

const apply = process.argv.includes('--apply');
// MIGRATION_DB_URL is the project's convention for pointing a one-off script at
// production; falls back to the ambient DATABASE_URL (also works in `railway run`).
const prisma = new PrismaClient({
  datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL,
});

const report = (r) => {
  console.log(`\n=== ${r.dryRun ? 'DRY RUN' : 'APPLIED'} — recovery sweep for ${r.day} ===`);
  if (r.skipped) {
    console.log(`  ABORTED: ${r.skipped}`);
    return;
  }
  console.log(`  OPEN deals audited                       : ${r.audited}`);
  console.log(`  already had a live GOS task (no action)  : ${r.alreadyActive}`);
  console.log(`  needed recovery                          : ${r.needRecovery}`);
  console.log(`     ├─ only legacy/imported open tasks    : ${r.legacyOnly}`);
  console.log(`     └─ no open task at all                : ${r.noOpenTask}`);
  console.log(`  blocked by a same-day follow-up (rerun)  : ${r.sameDayBlocked}`);
  console.log(`  eligible for a new task                  : ${r.candidates}`);
  console.log(`  tasks CREATED                            : ${r.created}`);
};

console.log(`Canonical task title: "${FOLLOW_UP_TITLE}"  (type key: follow_up)`);

const dry = await runMissingTaskSweep({ excludeLegacyTasks: true, dryRun: true, db: prisma });
report(dry);
if (dry.orderNos?.length) {
  console.log(`\n  deals that would receive a task (order numbers):\n    ${dry.orderNos.join(', ')}`);
}

if (!apply) {
  console.log('\nDry run only — re-run with --apply to write.');
} else if (!dry.candidates) {
  console.log('\nNothing to create — already complete.');
} else {
  const done = await runMissingTaskSweep({ excludeLegacyTasks: true, db: prisma });
  report(done);

  // Verify idempotency for real, on the same connection: a third pass must be
  // a no-op. Cheaper to prove here than to discover on a rerun.
  const again = await runMissingTaskSweep({ excludeLegacyTasks: true, dryRun: true, db: prisma });
  console.log(`\n  idempotency check — a rerun would create: ${again.candidates} (expected 0)`);
  if (again.candidates !== 0) console.log('  ⚠ NOT IDEMPOTENT — investigate before rerunning.');
}

await prisma.$disconnect();
