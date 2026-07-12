// READ-ONLY diagnostic — Tour "twin" investigation (Part O of the tours
// lifecycle audit). Reconstructs, from production rows, every Deal that is
// connected to MORE THAN ONE TourEvent, so each extra row can be classified:
//
//   • real cancelled Tour (business cancellation)
//   • legitimate separate Tour (e.g. group-slot replacement, re-WON)
//   • erroneous replacement/version duplicate (the suspected bug)
//
// The script performs ZERO writes. It prints, per affected deal:
//   - every TourEvent (id, status, kind, date/time, product/variant,
//     createdAt, cancelledAt, gcalEventId + sync status)
//   - every Booking on those tours (status + createdAt)
//   - child-record footprint per tour (assignments, components, payroll
//     activity + entry states, gallery items, questionnaire submissions)
//   - the deal's tour-related Timeline entries (created / cancelled /
//     tour_update_applied / tour_state_saved_to_plan / won_reference) so the
//     mutation SEQUENCE that produced each row is visible
//
// Run (Railway env injected, credentials never printed):
//   railway run -- node scripts/diagnose-tour-twins.mjs           (from server/)
// Optional: DIAG_DEAL_ID=<dealId> to focus one deal.

import { PrismaClient } from '@prisma/client';

// Local runs can't reach Railway's private network — prefer the Postgres
// service's public URL when injected (railway run --service Postgres …).
const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

function fmt(dt) {
  return dt ? new Date(dt).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

async function main() {
  const focusDealId = process.env.DIAG_DEAL_ID || null;

  // Every booking, joined to its tour + deal — the linkage table of the
  // investigation. Includes cancelled bookings on purpose (the twins are
  // expected to hang off cancelled bookings).
  const bookings = await prisma.booking.findMany({
    where: focusDealId ? { dealId: focusDealId } : {},
    select: {
      id: true,
      status: true,
      createdAt: true,
      seats: true,
      dealId: true,
      tourEventId: true,
      deal: { select: { id: true, orderNo: true, title: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byDeal = new Map();
  for (const b of bookings) {
    if (!byDeal.has(b.dealId)) byDeal.set(b.dealId, []);
    byDeal.get(b.dealId).push(b);
  }

  // Deals linked (via bookings, any status) to >1 DISTINCT TourEvent.
  const suspects = [...byDeal.entries()].filter(
    ([, list]) => new Set(list.map((b) => b.tourEventId)).size > 1,
  );

  console.log(`bookings scanned: ${bookings.length}`);
  console.log(`deals with >1 distinct TourEvent: ${suspects.length}\n`);

  let groupSlotOnly = 0;
  const detailed = [];
  for (const [dealId, list] of suspects) {
    const tourIds = [...new Set(list.map((b) => b.tourEventId))];
    const tours = await prisma.tourEvent.findMany({
      where: { id: { in: tourIds } },
      select: {
        id: true, kind: true, status: true, date: true, startTime: true,
        createdAt: true, cancelledAt: true, completedAt: true,
        gcalEventId: true, gcalSyncStatus: true,
        product: { select: { nameHe: true } },
        productVariant: { select: { id: true, location: { select: { nameHe: true } } } },
        _count: { select: { assignments: true, activityComponents: true, bookings: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    // Group-slot replacements (החלף סיור between slots) are a LEGITIMATE
    // multi-tour linkage — count them separately, detail only mixed/private.
    if (tours.every((t) => t.kind === 'group_slot')) {
      groupSlotOnly += 1;
      continue;
    }
    detailed.push({ dealId, list, tours });
  }

  console.log(`  … of which group-slot-only linkages (legitimate replace/re-slot): ${groupSlotOnly}`);
  console.log(`  … private/business (or mixed) deals needing classification: ${detailed.length}\n`);

  for (const { dealId, list, tours } of detailed) {
    const deal = list[0].deal;
    console.log('═'.repeat(78));
    console.log(`DEAL ${deal.orderNo ?? ''} [${dealId}] "${deal.title ?? ''}" status=${deal.status}`);

    for (const t of tours) {
      const [payroll, gallery, submissions] = await Promise.all([
        prisma.payrollActivity.findUnique({
          where: { tourEventId: t.id },
          select: { id: true, state: true, entries: { select: { state: true, officeStatus: true } } },
        }).catch(() => null),
        prisma.tourMedia
          .count({ where: { gallery: { tourEventId: t.id }, deletedAt: null } })
          .catch(() => null),
        prisma.questionnaireSubmission
          .count({ where: { subjectType: 'tour_event', subjectId: t.id } })
          .catch(() => null),
      ]);
      console.log(
        `  TOUR ${t.id} kind=${t.kind} status=${t.status} date=${t.date ?? '—'} ${t.startTime ?? ''}` +
        `\n    product=${t.product?.nameHe ?? '—'} · ${t.productVariant?.location?.nameHe ?? '—'} (variant ${t.productVariant?.id ?? '—'})` +
        `\n    createdAt=${fmt(t.createdAt)} cancelledAt=${fmt(t.cancelledAt)} completedAt=${fmt(t.completedAt)}` +
        `\n    gcal=${t.gcalEventId ?? '—'} (${t.gcalSyncStatus ?? '—'})` +
        `\n    children: assignments=${t._count.assignments} components=${t._count.activityComponents} bookings=${t._count.bookings}` +
        ` payroll=${payroll ? `${payroll.state}/${payroll.entries.length} entries` : '—'}` +
        ` gallery=${gallery ?? 'n/a'} submissions=${submissions ?? 'n/a'}`,
      );
    }

    for (const b of list) {
      console.log(`  BOOKING ${b.id} → tour ${b.tourEventId} status=${b.status} seats=${b.seats ?? '—'} createdAt=${fmt(b.createdAt)}`);
    }

    // The mutation sequence: deal-scoped tour timeline + each tour's own trail.
    const timeline = await prisma.timelineEntry.findMany({
      where: {
        OR: [
          { subjectType: 'deal', subjectId: dealId, kind: { in: ['tour', 'quote', 'change'] } },
          { subjectType: 'tour_event', subjectId: { in: tours.map((t) => t.id) } },
        ],
        deletedAt: null,
      },
      select: { subjectType: true, subjectId: true, kind: true, body: true, data: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log('  TIMELINE:');
    for (const e of timeline) {
      const ev = e.data?.event ? ` [${e.data.event}]` : '';
      const body = (e.body || '').replace(/\s+/g, ' ').slice(0, 90);
      console.log(`    ${fmt(e.createdAt)} ${e.subjectType}${ev} ${body}`);
    }
    console.log('');
  }

  if (!detailed.length) {
    console.log('No private/business deals with multiple TourEvents found.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
