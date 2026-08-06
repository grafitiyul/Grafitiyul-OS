// Repair: deals whose registration never received the settlement stamp.
//
// The defect (fixed in deals/paymentWon.js + tours/registrations.js): the money
// stamp lived inside settleDealWon's "the tour was created" branch AND only ran
// when a slot id already existed. So two real cases were left unstamped —
//   * a private deal that paid without a prior reservation (the tour was created
//     right there, but its id was never captured) — #27060;
//   * a deal whose tour could not be created at payment time and arrived later
//     through the recovery flow — #27105, #27074.
// The seat still counted ('active' is the legacy synonym for confirmed), so
// nothing visibly broke; the settlement record was simply missing.
//
// This script only ever stamps what the frozen Deal.wonActor already PROVES.
// A manually closed deal returns null from settledPaymentStateFor and is
// skipped — no payment is ever invented. It reuses the SAME function the
// runtime uses, so the repaired rows are indistinguishable from correct ones,
// and it is idempotent (a settled row is excluded by the stamp's own guard).
//
// Usage:
//   node scripts/repair-settled-registrations.mjs            # dry run
//   node scripts/repair-settled-registrations.mjs --apply    # write

import { PrismaClient } from '@prisma/client';
import { settledPaymentStateFor } from '../src/deals/resolveActivityType.js';
import { stampSettledRegistration } from '../src/tours/registrations.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ORDER_NOS = [27105, 27074, 27060];

const line = (s = '') => console.log(s);

async function main() {
  line(APPLY ? '=== APPLY (writing) ===' : '=== DRY RUN (no writes) ===');

  for (const orderNo of ORDER_NOS) {
    line(`\n--- Deal #${orderNo} ---`);
    const deal = await prisma.deal.findFirst({
      where: { orderNo },
      select: { id: true, orderNo: true, status: true, wonAt: true, wonActor: true },
    });
    if (!deal) { line('  SKIP: not found'); continue; }
    if (deal.status !== 'won') { line(`  SKIP: status=${deal.status}, not won`); continue; }

    const settled = settledPaymentStateFor(deal);
    line(`  wonActor.cause = ${deal.wonActor?.cause ?? '(none)'} → ${settled ? `paymentStatus='${settled.paymentStatus}'` : 'NO PROVEN PAYMENT'}`);
    if (!settled) { line('  SKIP: no provable payment evidence — nothing stamped'); continue; }

    // Corroborating evidence, printed so the decision is auditable rather than trusted.
    const docs = await prisma.icountDocument.findMany({
      where: { dealId: deal.id, status: 'issued' },
      select: { doctype: true, docnum: true, amountMinor: true },
    });
    line(`  issued documents: ${docs.length ? docs.map((d) => `${d.doctype} #${d.docnum} (₪${Number(d.amountMinor) / 100})`).join(', ') : '(none)'}`);
    if (!docs.length) line('  NOTE: no issued document — wonActor is the only evidence; review before applying.');

    const booking = await prisma.booking.findFirst({
      where: { dealId: deal.id, status: 'active' },
      select: { id: true, tourEventId: true },
    });
    if (!booking) { line('  SKIP: no active booking — nothing to stamp (recovery still owed)'); continue; }

    const before = await prisma.ticketRegistration.findMany({
      where: { dealId: deal.id, tourEventId: booking.tourEventId },
      select: { id: true, status: true, paymentStatus: true, confirmedAt: true },
    });
    for (const r of before) {
      line(`  registration ${r.id}: status=${r.status} paymentStatus=${r.paymentStatus ?? 'null'} confirmedAt=${r.confirmedAt ? r.confirmedAt.toISOString() : 'null'}`);
    }

    if (!APPLY) {
      const wouldStamp = before.filter(
        (r) => ['active', 'confirmed'].includes(r.status)
          && !(r.status === 'confirmed' && r.paymentStatus === settled.paymentStatus && r.confirmedAt),
      );
      line(`  WOULD STAMP ${wouldStamp.length} row(s) → status='confirmed', paymentStatus='${settled.paymentStatus}', confirmedAt=now`);
      continue;
    }

    const count = await prisma.$transaction((tx) =>
      stampSettledRegistration(tx, {
        dealId: deal.id,
        tourEventId: booking.tourEventId,
        paymentStatus: settled.paymentStatus,
      }),
    );
    line(`  STAMPED ${count} row(s)`);
    const after = await prisma.ticketRegistration.findMany({
      where: { dealId: deal.id, tourEventId: booking.tourEventId },
      select: { id: true, status: true, paymentStatus: true, confirmedAt: true },
    });
    for (const r of after) {
      line(`  → ${r.id}: status=${r.status} paymentStatus=${r.paymentStatus} confirmedAt=${r.confirmedAt?.toISOString()}`);
    }
  }
  line('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
