// Runner for the empty-completed-tour repair.
//
//   node scripts/repair-empty-completed-tours.mjs          # dry run
//   node scripts/repair-empty-completed-tours.mjs --apply  # write
//
// Prints every affected tour before and after. After the flip it drives the
// SAME canonical downstream services the live cancellation uses — payroll parks
// as cancelled, the calendar and Woo mirrors reconcile. No customer message is
// sent: this repair only ever touches tours that never had a customer.

import { PrismaClient } from '@prisma/client';
import {
  findEmptyCompletedTours,
  repairEmptyCompletedTours,
} from '../src/maintenance/repairEmptyCompletedTours.js';
import { cancelTourPayroll } from '../src/payroll/service.js';
import { calendarPendingPatch } from '../src/tours/calendar/service.js';
import { wooPendingPatch } from '../src/tours/woo/service.js';
import { emitTimelineEvent, systemOrigin } from '../src/timeline/events.js';
import { EMPTY_TOUR_CANCEL_BODY } from '../src/tours/completion.js';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({
  datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL,
});

const show = (rows, title) => {
  console.log(`\n=== ${title}: ${rows.length} ===`);
  for (const t of rows) {
    console.log(
      `  tour ${t.id}  ${t.date} ${t.startTime ?? ''}` +
        `  completedAt=${t.completedAt ? t.completedAt.toISOString() : '-'}` +
        `  generatedSlot=${t.openTourTemplateId ? 'yes' : 'no'}` +
        `  guides=${t._count.assignments}`,
    );
  }
};

const before = await findEmptyCompletedTours(prisma);
show(before, 'BEFORE — group tours completed with nobody on them');

if (!before.length) {
  console.log('\nNothing to repair.');
} else if (!apply) {
  console.log(`\nDRY RUN — would flip ${before.length} tour(s) from 'completed' to 'cancelled'.`);
  console.log('Re-run with --apply to write.');
} else {
  const r = await repairEmptyCompletedTours(prisma, { apply: true });
  console.log(`\nAPPLIED — ${r.repaired} tour(s) cancelled.`);
  for (const t of before) {
    await emitTimelineEvent(prisma, {
      subjectType: 'tour_event',
      subjectId: t.id,
      kind: 'tour',
      body: EMPTY_TOUR_CANCEL_BODY,
      data: { event: 'cancelled', reason: 'no_registrations', backfill: true },
      origin: systemOrigin(),
    });
    try {
      await cancelTourPayroll(prisma, t.id, 'tour_cancelled');
    } catch (e) {
      console.warn(`  payroll park failed for ${t.id}: ${e.message}`);
    }
    // Cancellation changes calendar presence + public sellability; the workers
    // converge asynchronously.
    await prisma.tourEvent.update({
      where: { id: t.id },
      data: { ...calendarPendingPatch(), ...wooPendingPatch('empty_tour_cancel') },
    });
  }
  console.log(`Parked payroll and re-marked calendar + Woo for ${before.length} tour(s).`);
  const after = await findEmptyCompletedTours(prisma);
  show(after, 'AFTER — remaining empty completed tours (expect 0)');
  console.log(after.length === 0 ? '\nRepair complete and idempotent.' : '\n!! rows remain — investigate !!');
}

await prisma.$disconnect();
