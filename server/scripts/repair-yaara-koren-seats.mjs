// ONE operational repair, owner-decided: deal #26283 (יערה כורם, 01/08 10:00).
//
//   railway run --service Grafitiyul-OS node server/scripts/repair-yaara-koren-seats.mjs [--execute]
//
// The 4-year-old attends but does NOT occupy a seat (owner ruling 2026-08-01).
// Target operational state: 3 seats — 2 × adult + 1 × child, סיור וסדנת גרפיטי,
// reconciling to the ₪700 already agreed and paid:
//     2 × ₪250 + 1 × ₪200 = ₪700  ✓  (live Florentin card prices)
//
// Route: the CANONICAL one. Write the purchased tickets into the Group Ticket
// Builder (sourceKind='group_ticket' quote lines) and set participants, then run
// resyncDealGroupTours() — the same function a Builder save runs. Quantity,
// ticketBreakdown, dominant variant and Booking.seats are all derived by
// production code. Deal.valueMinor is NOT touched: the tickets are made to
// reconcile to the agreed total, never the reverse.
//
// The toddler stays visible in customerInfo/notes and is deliberately absent
// from occupancy.
import { PrismaClient } from '@prisma/client';
import { resyncDealGroupTours } from '../src/tours/tourFromDeal.js';
import { resolveDealGroupOffering } from '../src/deals/groupOffering.js';
import { occupancyFor } from '../src/tours/occupancy.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1);

const ORDER_NO = 26283;
const CARD = 'card_d8304425-ace0-4216-95dd-29f6705dbd5b';       // סיור וסדנת גרפיטי @ פלורנטין
const VARIANT = 'cmquk0ejl001lqcpmg1xj5cbf';
const TICKETS = [
  { label: 'סיור וסדנת גרפיטי — מבוגר', ticketTypeId: 'tickettype_adult', quantity: 2, unitPriceMinor: 25000n },
  { label: 'סיור וסדנת גרפיטי — ילד', ticketTypeId: 'tickettype_child', quantity: 1, unitPriceMinor: 20000n },
];
const TARGET_SEATS = TICKETS.reduce((n, t) => n + t.quantity, 0);
const TARGET_MINOR = TICKETS.reduce((n, t) => n + Number(t.unitPriceMinor) * t.quantity, 0);

const deal = await prisma.deal.findFirst({
  where: { orderNo: ORDER_NO },
  select: { id: true, orderNo: true, title: true, status: true, activityType: true, participants: true, valueMinor: true, customerInfo: true },
});
if (!deal) { console.error('deal not found'); process.exit(1); }

async function snapshot(label) {
  const booking = await prisma.booking.findFirst({ where: { dealId: deal.id, status: 'active' }, select: { id: true, seats: true, tourEventId: true } });
  const regs = await prisma.ticketRegistration.findMany({
    where: { dealId: deal.id },
    select: { id: true, source: true, status: true, quantity: true, ticketBreakdown: true, productVariantId: true, bookingId: true },
  });
  const occ = booking ? await occupancyFor(prisma, [booking.tourEventId]) : {};
  const d = await prisma.deal.findUnique({ where: { id: deal.id }, select: { participants: true, valueMinor: true } });
  console.log(`\n── ${label} ──`);
  console.log(`participants ${d.participants} · value ₪${Number(d.valueMinor) / 100}`);
  console.log('booking      :', J(booking));
  console.log('registrations:', J(regs));
  console.log('tour occupancy:', J(occ));
  return { booking, regs, occ };
}

console.log(`deal #${deal.orderNo} — ${deal.title} · ${deal.status} · activityType ${deal.activityType}`);
console.log(`target: ${TARGET_SEATS} seats · ₪${TARGET_MINOR / 100} (agreed ₪${Number(deal.valueMinor) / 100})`);
if (TARGET_MINOR !== Number(deal.valueMinor)) {
  console.error(`REFUSING — tickets total ₪${TARGET_MINOR / 100} but the deal holds ₪${Number(deal.valueMinor) / 100}. The tickets must reconcile to the agreed amount.`);
  process.exit(1);
}
const beforeState = await snapshot('BEFORE');
if (!beforeState.booking) { console.error('no active booking'); process.exit(1); }

if (!EXECUTE) { console.log('\n--dry: nothing written. Re-run with --execute.'); await prisma.$disconnect(); process.exit(0); }

await prisma.$transaction(async (tx) => {
  // The Builder's working version — created if the deal never had one.
  let version = await tx.quoteVersion.findFirst({ where: { dealId: deal.id, isWorking: true }, select: { id: true } });
  if (!version) version = await tx.quoteVersion.create({ data: { dealId: deal.id, isWorking: true, status: 'draft', vatMode: 'included' }, select: { id: true } });
  else await tx.quoteVersion.update({ where: { id: version.id }, data: { vatMode: 'included' } });

  // Replace-sync the group-ticket lines (the Builder owns them).
  await tx.quoteLine.deleteMany({ where: { quoteVersionId: version.id, sourceKind: 'group_ticket' } });
  await tx.quoteLine.createMany({
    data: TICKETS.map((t, i) => ({
      quoteVersionId: version.id, kind: 'manual', label: t.label,
      quantity: t.quantity, unitPriceMinor: t.unitPriceMinor,
      vatMode: 'inherit', active: true, overridden: true,
      sourceKind: 'group_ticket', sourceCardGroupId: CARD,
      ticketTypeId: t.ticketTypeId, productVariantId: VARIANT,
      sortOrder: i,
    })),
  });
  // Seats follow the paying tickets — the toddler is not one.
  await tx.deal.update({ where: { id: deal.id }, data: { participants: TARGET_SEATS } });
  // THE canonical conversion.
  const tours = await resyncDealGroupTours(tx, deal.id, { origin: { actorType: 'system', actorLabel: 'תיקון ידני — 3 מקומות, פעוטה אינה תופסת מקום' } });
  console.log('resync touched tours:', J(tours));
}, { timeout: 120000, maxWait: 30000 });

const afterState = await snapshot('AFTER');
const offering = await resolveDealGroupOffering(prisma, deal.id);
const reg = afterState.regs.find((r) => r.bookingId === afterState.booking.id);
console.log('\n── RESULT ──');
console.log(`  Booking.seats            : ${beforeState.booking.seats} → ${afterState.booking.seats}   (target ${TARGET_SEATS})`);
console.log(`  registration quantity    : ${beforeState.regs[0]?.quantity} → ${reg?.quantity}`);
console.log(`  tour occupancy           : ${beforeState.occ[beforeState.booking.tourEventId]?.activeSeats} → ${afterState.occ[afterState.booking.tourEventId]?.activeSeats}`);
console.log(`  registrations for deal   : ${afterState.regs.length} (must stay 1)`);
console.log(`  builder reconciles       : ₪${TARGET_MINOR / 100} vs deal ₪${Number(deal.valueMinor) / 100}`);
console.log(`  breakdown                : ${J(offering?.ticketBreakdown)}`);
await prisma.$disconnect();
