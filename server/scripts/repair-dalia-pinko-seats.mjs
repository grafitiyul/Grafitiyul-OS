// ONE operational repair: deal #26399 (דליה פינקו, 20/08 13:00) must hold 3
// seats — 2 × סיור וסדנת גרפיטי + 1 × סיור גרפיטי — not 2.
//
//   railway run --service Grafitiyul-OS node server/scripts/repair-dalia-pinko-seats.mjs [--execute]
//
// ── Why the Builder edit did nothing ────────────────────────────────────────
// Seat truth for an Open Tour is the TicketRegistration (occupancy.js sums
// ACTIVE registrations; Booking.seats is CRM linkage). The Builder does have a
// canonical conversion — saving price lines calls resyncDealGroupTours(), which
// re-derives the purchased offering from the group_ticket lines and pushes it
// onto the registration. That function selects the rows it manages with:
//
//     where: { dealId, source: 'deal', ... }
//
// Dalia's registration came from the migration, so its source is 'migration'.
// The resync matched nothing, returned [], and the Builder edit correctly
// changed only commercial data. Same reason syncDealRegistration() would not
// have found it: it looks up (bookingId, source='deal') and, failing that, only
// adopts a held/expired reservation — hers is confirmed. Running the canonical
// sync without this repair would have CREATED A SECOND registration and
// double-counted her seats.
//
// ── The repair ──────────────────────────────────────────────────────────────
// 1. ADOPT the migrated row into the canonical identity the service manages
//    (source='deal', externalOrderId=dealId, externalLineId=bookingId). Same
//    row — no new registration, no new booking, no new deal or contact.
// 2. Then let the CANONICAL path do the actual work: resyncDealGroupTours(),
//    the very function the Builder save calls. Quantity, ticketBreakdown,
//    dominant variant, booking seats and the tour's operational product are all
//    computed by production code, not by this script.
//
// Idempotent: step 1 is a no-op once adopted; step 2 is convergent by design.
import { PrismaClient } from '@prisma/client';
import { resyncDealGroupTours } from '../src/tours/tourFromDeal.js';
import { resolveDealGroupOffering } from '../src/deals/groupOffering.js';
import { occupancyFor } from '../src/tours/occupancy.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const ORDER_NO = 26399;
const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1);

const deal = await prisma.deal.findFirst({
  where: { orderNo: ORDER_NO },
  select: { id: true, orderNo: true, title: true, status: true, activityType: true, participants: true, valueMinor: true },
});
if (!deal) { console.error(`deal #${ORDER_NO} not found`); process.exit(1); }

async function snapshot(label) {
  const booking = await prisma.booking.findFirst({
    where: { dealId: deal.id, status: 'active' },
    select: { id: true, seats: true, status: true, tourEventId: true },
  });
  const regs = await prisma.ticketRegistration.findMany({
    where: { dealId: deal.id },
    select: { id: true, source: true, status: true, quantity: true, ticketBreakdown: true, productVariantId: true, bookingId: true, externalOrderId: true, externalLineId: true, tourEventId: true },
  });
  const occ = booking ? await occupancyFor(prisma, [booking.tourEventId]) : {};
  const tourRegs = booking ? await prisma.ticketRegistration.count({ where: { tourEventId: booking.tourEventId } }) : 0;
  console.log(`\n── ${label} ──`);
  console.log('booking      :', J(booking));
  console.log('registrations:', J(regs));
  console.log('tour occupancy:', J(occ), `| registrations on that tour (all deals): ${tourRegs}`);
  return { booking, regs, occ };
}

console.log(`deal #${deal.orderNo} — ${deal.title} · status ${deal.status} · activityType ${deal.activityType} · participants ${deal.participants} · ₪${Number(deal.valueMinor) / 100}`);
const offering = await resolveDealGroupOffering(prisma, deal.id);
console.log('\ncanonical offering resolved from the Builder lines:');
console.log(J(offering));

const before = await snapshot('BEFORE');
if (!before.booking) { console.error('no active booking — nothing to repair'); process.exit(1); }

const orphanRows = before.regs.filter((r) => r.source !== 'deal' && r.bookingId === before.booking.id);
console.log(`\nmigrated registrations to adopt: ${orphanRows.length}`);

if (!EXECUTE) {
  console.log('\n--dry: nothing written. Re-run with --execute.');
  await prisma.$disconnect();
  process.exit(0);
}

// Generous timeout: this runs over the public DB proxy, where each round trip
// costs ~1s and the canonical resync makes several.
await prisma.$transaction(async (tx) => {
  // 1. adoption — same row, canonical identity.
  for (const r of orphanRows) {
    await tx.ticketRegistration.update({
      where: { id: r.id },
      data: { source: 'deal', externalOrderId: deal.id, externalLineId: before.booking.id },
    });
  }
  // 2. the canonical conversion — exactly what saving the Builder runs.
  const tourIds = await resyncDealGroupTours(tx, deal.id, { origin: { actorType: 'system', actorLabel: 'תיקון ידני — התאמת מושבים להזמנה' } });
  console.log('resyncDealGroupTours touched tours:', J(tourIds));
}, { timeout: 120000, maxWait: 30000 });

const after = await snapshot('AFTER');
const reg = after.regs.find((r) => r.bookingId === after.booking.id);
const seats = after.occ[after.booking.tourEventId]?.activeSeats;
console.log('\n── RESULT ──');
console.log(`  booking seats        : ${before.booking.seats} → ${after.booking.seats}`);
console.log(`  registration quantity: ${before.regs.find((r) => r.bookingId === before.booking.id)?.quantity} → ${reg?.quantity}`);
console.log(`  tour active seats    : ${before.occ[before.booking.tourEventId]?.activeSeats} → ${seats}`);
console.log(`  registrations for this deal: ${after.regs.length} (must stay 1)`);
console.log(`  ticket breakdown     : ${J(reg?.ticketBreakdown)}`);
await prisma.$disconnect();
