// Runner for the duplicate-booking-registration repair.
//
//   node scripts/repair-duplicate-booking-registrations.mjs          # dry run
//   node scripts/repair-duplicate-booking-registrations.mjs --apply  # write
//
// Prints every affected booking before and after, so the repair is auditable
// rather than a silent bulk update. Releasing a twin changes the tour's seat
// truth, so each touched tour is re-derived and re-marked for the Woo mirror.

import { PrismaClient } from '@prisma/client';
import {
  findDuplicateBookingRegistrations,
  repairDuplicateBookingRegistrations,
} from '../src/maintenance/repairDuplicateBookingRegistrations.js';
import { recomputeTourOperationalProduct } from '../src/tours/operationalProduct.js';
import { markTourWooPending } from '../src/tours/woo/service.js';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({
  datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL,
});

const show = (rows, title) => {
  console.log(`\n=== ${title}: ${rows.length} ===`);
  for (const b of rows) {
    console.log(
      `  booking ${b.bookingId} (${b.bookingStatus})  deal #${b.orderNo ?? '?'} (${b.dealStatus ?? '?'})\n` +
        `     tour ${b.tourDate} ${b.tourStartTime ?? ''} (${b.tourStatus})  bookingSeats=${b.bookingSeats}\n` +
        `     keep    ${b.keep.id}  ${b.keep.source}  q=${b.keep.quantity}\n` +
        b.release.map((r) => `     release ${r.id}  ${r.source}  ${r.status}  q=${r.quantity}`).join('\n') +
        `\n     phantomSeats=${b.phantomSeats}`,
    );
  }
};

const before = await findDuplicateBookingRegistrations(prisma);
show(before, 'BEFORE — bookings holding more than one live registration');

if (!before.length) {
  console.log('\nNothing to repair.');
} else if (!apply) {
  const seats = before.reduce((s, b) => s + b.phantomSeats, 0);
  const tours = new Set(before.map((b) => b.tourEventId)).size;
  console.log(
    `\nDRY RUN — would release ${before.reduce((n, b) => n + b.release.length, 0)} stale registration(s) ` +
      `across ${tours} tour(s), freeing ${seats} phantom seat(s).`,
  );
  console.log('Re-run with --apply to write.');
} else {
  const tourIds = [...new Set(before.map((b) => b.tourEventId))];
  const r = await repairDuplicateBookingRegistrations(prisma, { apply: true });
  console.log(`\nAPPLIED — ${r.released} stale registration(s) released.`);
  for (const id of tourIds) {
    await recomputeTourOperationalProduct(prisma, id);
    await markTourWooPending(prisma, id);
  }
  console.log(`Re-derived ${tourIds.length} tour(s) and marked their Woo mirror pending.`);
  const after = await findDuplicateBookingRegistrations(prisma);
  show(after, 'AFTER — remaining divergent bookings (expect 0)');
  console.log(after.length === 0 ? '\nRepair complete and idempotent.' : '\n!! rows remain — investigate !!');
}

await prisma.$disconnect();
