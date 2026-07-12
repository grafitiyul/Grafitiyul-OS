// GUARDED backfill — mark historical reopen→re-WON tour twins as superseded.
// Companion to scripts/diagnose-tour-twins.mjs (Part O of the tours lifecycle
// audit). DRY-RUN by default; writes ONLY with --apply.
//
// Classification rule (conservative — every condition must hold):
//   a twin is a TourEvent that
//     1. is kind private|business AND status='cancelled'
//     2. is linked to a deal ONLY through CANCELLED bookings
//     3. has an 'auto_cancelled_empty' timeline event (i.e. it was cancelled
//        because its deal left — reopen/LOST/replace — never a direct
//        operator business-cancellation, which is impossible while a booking
//        is active anyway)
//     4. the SAME deal has a LATER tour (the canonical row) that is NOT
//        cancelled — completed or scheduled
//   → supersededByTourEventId = the deal's newest non-cancelled tour.
//
// Rows failing ANY condition are listed but never touched. Genuine business
// cancellations (deal went LOST and never re-WON → no later tour) stay
// visible under the בוטל filter, as they should.
//
// Run:
//   railway run --service Postgres node scripts/backfill-superseded-tours.mjs           (dry-run)
//   railway run --service Postgres node scripts/backfill-superseded-tours.mjs --apply   (write)

import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '*** APPLY MODE — will write ***' : '(dry-run — no writes; pass --apply to write)');

  const candidates = await prisma.tourEvent.findMany({
    where: {
      kind: { in: ['private', 'business'] },
      status: 'cancelled',
      supersededByTourEventId: null,
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      cancelledAt: true,
      createdAt: true,
      bookings: { select: { dealId: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`cancelled private/business tours (unmarked): ${candidates.length}`);

  const plan = [];
  const skipped = [];
  for (const t of candidates) {
    const dealIds = [...new Set(t.bookings.map((b) => b.dealId))];
    if (dealIds.length !== 1 || t.bookings.some((b) => b.status === 'active')) {
      skipped.push({ id: t.id, reason: 'booking_shape' });
      continue;
    }
    const dealId = dealIds[0];
    // JSON path filters are awkward across PG versions — fetch the tour's
    // events and check in JS (tiny sets per tour).
    const events = await prisma.timelineEntry.findMany({
      where: { subjectType: 'tour_event', subjectId: t.id, kind: 'tour', deletedAt: null },
      select: { data: true },
    });
    if (!events.some((e) => e.data?.event === 'auto_cancelled_empty')) {
      skipped.push({ id: t.id, reason: 'no_auto_cancelled_empty_event' });
      continue;
    }
    // The deal's newest NON-cancelled tour, created after this twin.
    const canonical = await prisma.tourEvent.findFirst({
      where: {
        status: { not: 'cancelled' },
        createdAt: { gt: t.createdAt },
        bookings: { some: { dealId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, date: true },
    });
    if (!canonical) {
      skipped.push({ id: t.id, reason: 'no_later_canonical_tour (genuine cancellation)' });
      continue;
    }
    plan.push({ twinId: t.id, twinDate: t.date, dealId, canonicalId: canonical.id, canonicalStatus: canonical.status });
  }

  console.log(`\nto mark as superseded: ${plan.length}`);
  for (const p of plan) {
    console.log(`  ${p.twinId} (date ${p.twinDate ?? '—'}) → superseded by ${p.canonicalId} [${p.canonicalStatus}] (deal ${p.dealId})`);
  }
  console.log(`\nleft untouched: ${skipped.length}`);
  for (const s of skipped) console.log(`  ${s.id} — ${s.reason}`);

  if (!APPLY || !plan.length) return;
  for (const p of plan) {
    await prisma.tourEvent.update({
      where: { id: p.twinId },
      data: { supersededByTourEventId: p.canonicalId },
    });
    await prisma.timelineEntry.create({
      data: {
        subjectType: 'tour_event',
        subjectId: p.twinId,
        kind: 'tour',
        body: '🧹 סומן ככפילות היסטורית של אותו סיור (תיקון מחזור חיים 2026-07) — מוסתר מהתצוגות',
        data: { event: 'superseded_marked', supersededBy: p.canonicalId },
        isSystem: true,
        actorType: 'system',
        actorLabel: 'מערכת — ניקוי כפילויות',
      },
    });
  }
  console.log(`\nAPPLIED: ${plan.length} rows marked (+ timeline event each).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
