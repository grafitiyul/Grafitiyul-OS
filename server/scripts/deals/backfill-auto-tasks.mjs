// E3 — controlled, idempotent backfill of follow-up tasks for currently-OPEN
// deals with no active task. Runs THE canonical sweep (tasks/autoTasks.js) —
// the same code the midnight worker runs — so the backfill and the nightly
// behavior can never diverge. Closed (WON/LOST) deals are excluded by
// construction; the sweep is idempotent per (deal, day).
//
// Dry-run:  DATABASE_URL=<prod> node server/scripts/deals/backfill-auto-tasks.mjs
// Apply:    DATABASE_URL=<prod> node server/scripts/deals/backfill-auto-tasks.mjs --apply
import { PrismaClient } from '@prisma/client';
import { runMissingTaskSweep } from '../../src/tasks/autoTasks.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const dry = await runMissingTaskSweep({ dryRun: true, db: prisma, log: console });
console.log(`day=${dry.day} candidates=${dry.candidates}`);
console.log('orderNos:', (dry.orderNos || []).join(', '));

if (APPLY) {
  const out = await runMissingTaskSweep({ db: prisma, log: console });
  console.log(`APPLIED: created=${out.created} of candidates=${out.candidates}`);
  const verify = await runMissingTaskSweep({ dryRun: true, db: prisma, log: console });
  console.log(`re-run verification: candidates now=${verify.candidates} (expected 0)`);
}
await prisma.$disconnect();
