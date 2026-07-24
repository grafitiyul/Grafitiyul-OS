// Narrowly-scoped, idempotent repair for Agent-Reservation Deals created before
// the Builder-population fix (defects #6/#7): Deals with value=0 and an empty
// Builder, even though the reservation froze a canonical price per group.
//
// It NEVER recomputes a price — it replays each group's FROZEN pricing snapshot
// (payloadSnapshot.pricingByGroup) through the SAME canonical writer the live
// processor now uses (writeReservationBuilder). That writer is:
//   • provenance-safe — a Builder version containing any non-reservation line
//     (a human edit) is skipped, never clobbered;
//   • idempotent — when the target lines + gross already match, it writes
//     nothing, so a second run reports ZERO changes.
//
// Scope guard: ONLY Deals reachable from a ReservationGroup.createdDealId are
// ever touched. No other Deal, and no side effect (no email/WhatsApp/payments/
// Woo/calendar/registrations/TourEvents/PDF regeneration) — this only writes
// QuoteOffer/QuoteVersion/QuoteLine + Deal.valueMinor.
//
// Usage (DATABASE_URL must point at the target DB):
//   node scripts/repair-agent-reservation-builder.mjs            # dry-run (default)
//   node scripts/repair-agent-reservation-builder.mjs --apply    # write changes

import { PrismaClient } from '@prisma/client';
import { writeReservationBuilder, builderClientLinesFromPricing } from '../src/reservations/reservationBuilder.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient({ log: ['warn', 'error'] });

function pricingForGroup(session, group) {
  const pbg = Array.isArray(session?.payloadSnapshot?.pricingByGroup)
    ? session.payloadSnapshot.pricingByGroup
    : [];
  return pbg[group.sortOrder] ?? null;
}

async function main() {
  console.log(`\n=== Agent-Reservation Builder repair — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`);

  // Every reservation group that produced a Deal, with its frozen snapshot.
  const groups = await prisma.reservationGroup.findMany({
    where: { createdDealId: { not: null } },
    include: { session: { select: { sessionNo: true, payloadSnapshot: true } } },
    orderBy: [{ session: { sessionNo: 'asc' } }, { sortOrder: 'asc' }],
  });

  let changed = 0;
  let already = 0;
  let skippedHuman = 0;
  let unpriced = 0;

  for (const g of groups) {
    const pricing = pricingForGroup(g.session, g);
    const target = builderClientLinesFromPricing(pricing, {
      productVariantId: g.productVariantId,
      productLabel: g.productLabel,
    });
    const deal = await prisma.deal.findUnique({
      where: { id: g.createdDealId },
      select: { orderNo: true, valueMinor: true },
    });
    const dealTag = `Deal #${deal?.orderNo} (session #${g.session.sessionNo}, "${g.groupName}")`;

    if (!target.priced) {
      unpriced += 1;
      console.log(`  ⦿ ${dealTag}: no exact frozen price (price-list fallback) — leaving Builder empty`);
      continue;
    }

    if (!APPLY) {
      // Dry-run: report the intended change without writing.
      const version = await prisma.quoteVersion.findFirst({ where: { dealId: g.createdDealId, isWorking: true }, select: { id: true } });
      const existing = version
        ? await prisma.quoteLine.findMany({ where: { quoteVersionId: version.id }, select: { sourceKind: true } })
        : [];
      const human = existing.some((l) => (l.sourceKind || null) !== 'agent_reservation');
      const curVal = deal?.valueMinor == null ? 0 : Number(deal.valueMinor);
      if (human) {
        skippedHuman += 1;
        console.log(`  ⚠ ${dealTag}: SKIP (human-edited Builder — ${existing.length} foreign line(s))`);
      } else if (curVal === target.valueMinor && existing.length === target.lines.length) {
        already += 1;
        console.log(`  = ${dealTag}: already correct (value=${curVal}, ${existing.length} lines)`);
      } else {
        changed += 1;
        console.log(`  → ${dealTag}: value ${curVal} → ${target.valueMinor}, lines ${existing.length} → ${target.lines.length}`);
      }
      continue;
    }

    // Apply: the canonical writer decides changed/idempotent/skip, in a tx.
    const res = await prisma.$transaction((tx) =>
      writeReservationBuilder(tx, {
        dealId: g.createdDealId,
        pricing,
        productVariantId: g.productVariantId,
        productLabel: g.productLabel,
      }),
    );
    if (res.skipped === 'human_edited') {
      skippedHuman += 1;
      console.log(`  ⚠ ${dealTag}: SKIP (human-edited Builder)`);
    } else if (res.changed) {
      changed += 1;
      console.log(`  ✓ ${dealTag}: wrote ${res.lineCount} line(s), value=${res.valueMinor}`);
    } else {
      already += 1;
      console.log(`  = ${dealTag}: no change (already correct)`);
    }
  }

  console.log(
    `\n=== ${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${groups.length} reservation Deal(s) — ` +
      `${changed} ${APPLY ? 'changed' : 'would change'}, ${already} already correct, ` +
      `${skippedHuman} skipped (human-edited), ${unpriced} unpriced ===\n`,
  );
  if (!APPLY) console.log('Re-run with --apply to write these changes.\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('REPAIR ERROR:', e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
