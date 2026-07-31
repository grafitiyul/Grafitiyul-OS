// Runner for the ghost-cancelled-booking repair.
//
//   node scripts/repair-ghost-cancelled-bookings.mjs          # dry run
//   node scripts/repair-ghost-cancelled-bookings.mjs --apply  # write
//
// Prints every affected row before and after, so the repair is auditable rather
// than a silent bulk update.

import { PrismaClient } from '@prisma/client';
import {
  findGhostCancelledBookings,
  repairGhostCancelledBookings,
} from '../src/maintenance/repairGhostCancelledBookings.js';

const apply = process.argv.includes('--apply');
// MIGRATION_DB_URL is the project's convention for pointing a one-off script at
// production (see GOS-cutover-checklist.md's shell preamble). Falls back to the
// ambient DATABASE_URL so the script also works inside `railway run`.
const prisma = new PrismaClient({
  datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL,
});

const show = (rows, title) => {
  console.log(`\n=== ${title}: ${rows.length} ===`);
  for (const b of rows) {
    console.log(
      `  booking ${b.id}\n` +
        `     deal #${b.deal?.orderNo ?? '?'} (${b.deal?.status ?? '?'})  tour ${b.tourEvent?.date} ${b.tourEvent?.startTime ?? ''} (${b.tourEvent?.status})\n` +
        `     seats=${b.seats}  liveRegistrations=${b.liveRegistrations}  liveSeats=${b.liveSeats}\n` +
        `     created=${b.createdAt.toISOString()}  lastWritten=${b.updatedAt.toISOString()}`,
    );
  }
};

const before = await findGhostCancelledBookings(prisma);
show(before, 'BEFORE — bookings cancelled while still owning live seats');

if (!before.length) {
  console.log('\nNothing to repair.');
} else if (!apply) {
  const seats = before.reduce((s, b) => s + b.liveSeats, 0);
  const tours = new Set(before.map((b) => b.tourEventId)).size;
  console.log(`\nDRY RUN — would restore ${before.length} booking(s) to 'active', across ${tours} tour(s), covering ${seats} seat(s).`);
  console.log('Re-run with --apply to write.');
} else {
  const r = await repairGhostCancelledBookings(prisma, { apply: true });
  console.log(`\nAPPLIED — ${r.repaired} booking(s) restored to 'active'.`);
  const after = await findGhostCancelledBookings(prisma);
  show(after, 'AFTER — remaining ghost-cancelled bookings (expect 0)');
  console.log(after.length === 0 ? '\nRepair complete and idempotent.' : '\n!! rows remain — investigate !!');
}

await prisma.$disconnect();
