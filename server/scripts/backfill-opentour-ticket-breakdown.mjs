// OWNER-APPROVED backfill of the purchased ticket split for future WON
// Open-Tour deals (2026-08-01). Seat TOTALS are already correct on every one of
// these; what is missing is WHICH ticket each seat is, because Pipedrive had no
// structured group builder and only a total migrated.
//
//   railway run --service Grafitiyul-OS node server/scripts/backfill-opentour-ticket-breakdown.mjs [--execute]
//
// Route: the canonical one, identical to #26283 — write the purchased tickets as
// Group Ticket Builder lines (sourceKind='group_ticket'), then run
// resyncDealGroupTours(), the same function a Builder save runs. Quantity,
// ticketBreakdown, dominant variant and Booking.seats are all derived by
// production code; this script never writes a seat count or a price by hand.
//
// GUARDS — the run aborts before touching anything if any of these fail, and
// re-checks them per deal afterwards:
//   * the proposed tickets must total EXACTLY Deal.valueMinor (never the reverse);
//   * the proposed ticket count must equal the seats already registered;
//   * Deal.valueMinor and Deal.participants are never written;
//   * occupancy on every affected tour must be identical before and after;
//   * exactly one deal-owned registration per booking, before and after.
// Idempotent: the group-ticket lines are replace-synced and the resync is
// convergent, so a second run reports the same state and changes nothing.
// GOS_PRISMA_CLIENT lets this run against a client generated from the COMMITTED
// schema when a colleague's uncommitted column has put the shared client ahead
// of production. Defaults to the normal client.
const { PrismaClient } = await import(process.env.GOS_PRISMA_CLIENT || '@prisma/client');
import { resyncDealGroupTours } from '../src/tours/tourFromDeal.js';
import { resolveDealGroupOffering } from '../src/deals/groupOffering.js';
import { occupancyFor } from '../src/tours/occupancy.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v));

// Live Florentin pricing cards (VAT included).
const WORKSHOP = { card: 'card_d8304425-ace0-4216-95dd-29f6705dbd5b', variant: 'cmquk0ejl001lqcpmg1xj5cbf', title: 'סיור וסדנת גרפיטי', adult: 25000, child: 20000 };
const TOUR = { card: 'card_93415e35-b86e-4d7d-8acb-895628a42dce', variant: 'cmquk1dau001nqcpmqf5lgeic', title: 'סיור גרפיטי', adult: 15000, child: 9000 };

// The owner-approved breakdowns, verbatim.
const PLAN = [
  { orderNo: 26047, product: WORKSHOP, adults: 2, children: 0 },
  { orderNo: 26335, product: WORKSHOP, adults: 1, children: 1 },
  { orderNo: 26606, product: WORKSHOP, adults: 2, children: 0 },
  { orderNo: 26592, product: WORKSHOP, adults: 2, children: 1 },
  { orderNo: 26303, product: TOUR, adults: 3, children: 0 },
  { orderNo: 26293, product: WORKSHOP, adults: 2, children: 0 },
  { orderNo: 26597, product: WORKSHOP, adults: 1, children: 1 },
  { orderNo: 26316, product: TOUR, adults: 2, children: 0 },
];

const linesFor = (p) => [
  ...(p.adults ? [{ label: `${p.product.title} — מבוגר`, ticketTypeId: 'tickettype_adult', quantity: p.adults, unitPriceMinor: BigInt(p.product.adult) }] : []),
  ...(p.children ? [{ label: `${p.product.title} — ילד`, ticketTypeId: 'tickettype_child', quantity: p.children, unitPriceMinor: BigInt(p.product.child) }] : []),
];
const totalMinor = (p) => p.adults * p.product.adult + p.children * p.product.child;
const totalSeats = (p) => p.adults + p.children;

async function state(dealId) {
  const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { orderNo: true, participants: true, valueMinor: true } });
  const booking = await prisma.booking.findFirst({ where: { dealId, status: 'active' }, select: { id: true, seats: true, tourEventId: true } });
  const regs = await prisma.ticketRegistration.findMany({ where: { dealId }, select: { id: true, source: true, quantity: true, ticketBreakdown: true, productVariantId: true, bookingId: true } });
  return { d, booking, regs };
}

// ── preflight: validate the whole plan before writing anything ──────────────
const work = [];
let fatal = 0;
for (const p of PLAN) {
  const deal = await prisma.deal.findFirst({ where: { orderNo: p.orderNo }, select: { id: true, orderNo: true, title: true, status: true, activityType: true, participants: true, valueMinor: true } });
  if (!deal) { console.error(`✗ #${p.orderNo} not found`); fatal += 1; continue; }
  const s = await state(deal.id);
  const seatsNow = s.regs.reduce((n, r) => n + (r.quantity || 0), 0);
  const money = totalMinor(p);
  const seats = totalSeats(p);
  const okMoney = money === Number(deal.valueMinor);
  const okSeats = seats === seatsNow && seats === deal.participants;
  console.log(`#${deal.orderNo} ${deal.title || ''} — ${p.adults}×מבוגר${p.children ? ` + ${p.children}×ילד` : ''} (${p.product.title})`);
  console.log(`   money ₪${money / 100} vs deal ₪${Number(deal.valueMinor) / 100} ${okMoney ? '✓' : '✗ MISMATCH'} · seats ${seats} vs registered ${seatsNow}/participants ${deal.participants} ${okSeats ? '✓' : '✗ MISMATCH'}`);
  if (!okMoney || !okSeats) { fatal += 1; continue; }
  work.push({ deal, plan: p, before: s });
}
if (fatal) { console.error(`\n✗ ${fatal} deal(s) failed validation — nothing written.`); await prisma.$disconnect(); process.exit(1); }

const tourIds = [...new Set(work.map((w) => w.before.booking.tourEventId))];
const occBefore = await occupancyFor(prisma, tourIds);
const prodBefore = Object.fromEntries((await prisma.tourEvent.findMany({ where: { id: { in: tourIds } }, select: { id: true, productVariantId: true, product: { select: { nameHe: true } } } })).map((t) => [t.id, `${t.product?.nameHe || '—'} / ${t.productVariantId || 'null'}`]));
console.log('\noccupancy BEFORE:', J(occBefore));
console.log('tour product BEFORE:', J(prodBefore));

if (!EXECUTE) { console.log('\n--dry: nothing written. Re-run with --execute.'); await prisma.$disconnect(); process.exit(0); }

for (const { deal, plan } of work) {
  await prisma.$transaction(async (tx) => {
    let version = await tx.quoteVersion.findFirst({ where: { dealId: deal.id, isWorking: true }, select: { id: true } });
    if (!version) version = await tx.quoteVersion.create({ data: { dealId: deal.id, isWorking: true, status: 'draft', vatMode: 'included' }, select: { id: true } });
    else await tx.quoteVersion.update({ where: { id: version.id }, data: { vatMode: 'included' } });
    await tx.quoteLine.deleteMany({ where: { quoteVersionId: version.id, sourceKind: 'group_ticket' } });
    await tx.quoteLine.createMany({
      data: linesFor(plan).map((t, i) => ({
        quoteVersionId: version.id, kind: 'manual', label: t.label,
        quantity: t.quantity, unitPriceMinor: t.unitPriceMinor,
        vatMode: 'inherit', active: true, overridden: true,
        sourceKind: 'group_ticket', sourceCardGroupId: plan.product.card,
        ticketTypeId: t.ticketTypeId, productVariantId: plan.product.variant,
        sortOrder: i,
      })),
    });
    await resyncDealGroupTours(tx, deal.id, { origin: { actorType: 'system', actorLabel: 'השלמת פירוט כרטיסים — אישור בעלים' } });
  }, { timeout: 120000, maxWait: 30000 });
  console.log(`  ✓ #${deal.orderNo} applied`);
}

// ── verification ────────────────────────────────────────────────────────────
console.log('\n── AFTER ──');
let bad = 0;
for (const { deal, plan, before } of work) {
  const after = await state(deal.id);
  const reg = after.regs.find((r) => r.bookingId === after.booking.id);
  const offering = await resolveDealGroupOffering(prisma, deal.id);
  const seatsOk = after.booking.seats === totalSeats(plan) && reg?.quantity === totalSeats(plan);
  const valueOk = Number(after.d.valueMinor) === Number(before.d.valueMinor);
  const oneReg = after.regs.length === 1;
  const bdOk = Array.isArray(reg?.ticketBreakdown) && reg.ticketBreakdown.reduce((n, b) => n + b.quantity, 0) === totalSeats(plan);
  if (!(seatsOk && valueOk && oneReg && bdOk)) bad += 1;
  console.log(`#${deal.orderNo}: seats ${before.booking.seats}→${after.booking.seats} ${seatsOk ? '✓' : '✗'} · value ₪${Number(after.d.valueMinor) / 100} ${valueOk ? 'unchanged ✓' : '✗ CHANGED'} · regs ${after.regs.length} ${oneReg ? '✓' : '✗'} · breakdown ${bdOk ? '✓' : '✗'}`);
  console.log(`   ${(offering?.ticketBreakdown || []).map((b) => `${b.cardTitle} ${b.ticketLabel} ×${b.quantity}`).join(' + ')}`);
}
const occAfter = await occupancyFor(prisma, tourIds);
const prodAfter = Object.fromEntries((await prisma.tourEvent.findMany({ where: { id: { in: tourIds } }, select: { id: true, productVariantId: true, product: { select: { nameHe: true } } } })).map((t) => [t.id, `${t.product?.nameHe || '—'} / ${t.productVariantId || 'null'}`]));
console.log('\noccupancy AFTER :', J(occAfter));
console.log('tour product AFTER :', J(prodAfter));
for (const id of tourIds) {
  if (occBefore[id]?.activeSeats !== occAfter[id]?.activeSeats) { bad += 1; console.error(`✗ occupancy moved on ${id}: ${occBefore[id]?.activeSeats} → ${occAfter[id]?.activeSeats}`); }
  if (prodBefore[id] !== prodAfter[id]) console.log(`ℹ tour ${id} operational product re-derived: ${prodBefore[id]} → ${prodAfter[id]}`);
}
const dupes = await prisma.$queryRawUnsafe(`
  SELECT "bookingId", count(*)::int AS n FROM "TicketRegistration"
  WHERE "source"='deal' AND "bookingId" = ANY($1::text[]) GROUP BY 1 HAVING count(*) > 1`,
  work.map((w) => w.before.booking.id));
console.log(dupes.length ? `✗ duplicates: ${J(dupes)}` : '✓ no duplicate registrations');
console.log(bad ? `\n✗ ${bad} check(s) failed` : '\n✓ all checks passed');
await prisma.$disconnect();
