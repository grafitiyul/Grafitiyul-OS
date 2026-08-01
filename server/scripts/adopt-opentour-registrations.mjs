// SAFETY REPAIR — adopt migration-sourced Open-Tour registrations into the
// canonical deal-owned identity.
//
//   railway run --service Grafitiyul-OS node server/scripts/adopt-opentour-registrations.mjs [--execute]
//
// ── Why ─────────────────────────────────────────────────────────────────────
// Both canonical writers select the registration they manage by source='deal':
//   * resyncDealGroupTours(): where { dealId, source: 'deal', … }
//   * syncDealRegistration(): findFirst({ bookingId, source: 'deal' }), with an
//     adoption fallback only for held/expired rows.
// A migrated row (source='migration', status='confirmed') matches neither, so:
//   1. filling the Group Ticket Builder silently changes no seats, and
//   2. ANY deal save on such a group deal falls through to the create branch and
//      writes a SECOND registration — both count for capacity, so the tour's
//      seats double.
//
// ── What this does ──────────────────────────────────────────────────────────
// Exactly one thing: rewrites the IDENTITY of the existing row —
// source='deal', externalOrderId=dealId, externalLineId=bookingId — which is
// the shape syncDealRegistration() looks up. The same row. Quantities, status,
// breakdown, variant and the Booking are all left untouched, so occupancy
// cannot move; the script asserts that per tour, before and after.
//
// Idempotent: an already-adopted row is not selected on the next run.
import { PrismaClient } from '@prisma/client';
import { occupancyFor } from '../src/tours/occupancy.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const TODAY = new Date().toISOString().slice(0, 10);
const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v));

const bookings = await prisma.booking.findMany({
  where: {
    status: 'active',
    tourEvent: { kind: 'group_slot', status: { in: ['scheduled', 'postponed'] }, date: { gte: TODAY } },
    deal: { status: 'won' },
  },
  select: {
    id: true, seats: true, dealId: true,
    tourEvent: { select: { id: true, date: true, startTime: true } },
    deal: { select: { orderNo: true, title: true } },
    ticketRegistrations: { select: { id: true, source: true, status: true, quantity: true, externalOrderId: true, externalLineId: true } },
  },
  orderBy: { tourEvent: { date: 'asc' } },
});

const targets = [];
for (const b of bookings) {
  for (const r of b.ticketRegistrations) {
    if (r.source !== 'deal') targets.push({ b, r });
  }
}
console.log(`future WON open-tour bookings: ${bookings.length}`);
console.log(`registrations needing adoption: ${targets.length}`);
for (const { b, r } of targets) {
  console.log(`  #${b.deal.orderNo} ${b.tourEvent.date} ${b.tourEvent.startTime} — reg ${r.id} source=${r.source} status=${r.status} qty=${r.quantity}`);
}
if (!targets.length) { console.log('nothing to adopt — all future open-tour registrations are already canonical.'); await prisma.$disconnect(); process.exit(0); }

const tourIds = [...new Set(targets.map((t) => t.b.tourEvent.id))];
const before = await occupancyFor(prisma, tourIds);
console.log('\noccupancy BEFORE:', J(before));

if (!EXECUTE) { console.log('\n--dry: nothing written. Re-run with --execute.'); await prisma.$disconnect(); process.exit(0); }

let adopted = 0;
for (const { b, r } of targets) {
  // One narrow update per row — no resync, no recompute, no quantity change.
  await prisma.ticketRegistration.update({
    where: { id: r.id },
    data: { source: 'deal', externalOrderId: b.dealId, externalLineId: b.id },
  });
  adopted += 1;
}
const after = await occupancyFor(prisma, tourIds);
console.log(`\nadopted: ${adopted}`);
console.log('occupancy AFTER :', J(after));

let drift = 0;
for (const id of tourIds) {
  if (before[id]?.activeSeats !== after[id]?.activeSeats) {
    drift += 1;
    console.error(`  ✗ OCCUPANCY MOVED on ${id}: ${before[id]?.activeSeats} → ${after[id]?.activeSeats}`);
  }
}
console.log(drift ? `\n✗ ${drift} tour(s) changed occupancy — investigate` : '\n✓ occupancy identical on every affected tour');

// Duplicate guard: one deal-owned registration per booking, always.
const dupes = await prisma.$queryRawUnsafe(`
  SELECT "bookingId", count(*)::int AS n FROM "TicketRegistration"
  WHERE "source"='deal' AND "bookingId" = ANY($1::text[])
  GROUP BY 1 HAVING count(*) > 1`, targets.map((t) => t.b.id));
console.log(dupes.length ? `✗ duplicate deal registrations: ${J(dupes)}` : '✓ no booking holds more than one deal registration');
await prisma.$disconnect();
