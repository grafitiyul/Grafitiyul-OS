// Repair Deals #26210 / #26618 — group registrations whose payable total was
// zeroed by register-without-payment although the customer PAID EXTERNALLY
// (Cardcom / אישורית זהב) and an iCount invrec on the exact gross already exists.
//
// The repair is the CANONICAL waiver cancel (reconcileWaiverAfterSave with
// decision:'cancel'): Deal.valueMinor returns to the commercial gross computed
// from the working QuoteVersion's group lines, noPaymentWaiver becomes null and
// the pinned waiver note evolves to "הפטור מתשלום בוטל". Nothing else changes:
// no new booking, no participant change, no document, no fabricated payment.
//
// Safety: each deal's recomputed gross MUST equal the independently-audited
// evidence amount (its issued iCount invrec total) or the deal is skipped.
// Idempotent: an already-repaired deal (no waiver + correct value) is a no-op.
//
// Run (dry-run):  DATABASE_URL=<prod> node server/scripts/deals/repair-zeroed-group-deals.mjs
// Apply:          DATABASE_URL=<prod> node server/scripts/deals/repair-zeroed-group-deals.mjs --apply
import { PrismaClient } from '@prisma/client';
import { loadGroupTicketLines } from '../../src/deals/waiver.js';
import { reconcileWaiverAfterSave } from '../../src/deals/registrationCompletion.js';
import { recordDealChanges } from '../../src/timeline/dealChangelog.js';
import { emitTimelineEvent, systemOrigin } from '../../src/timeline/events.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// orderNo → { expectedGrossMinor (== audited iCount invrec), invrecDocnum }
const TARGETS = [
  { orderNo: 26210, expectedGrossMinor: 100000, invrec: '38517' },
  { orderNo: 26618, expectedGrossMinor: 90000, invrec: '38518' },
];

for (const t of TARGETS) {
  const deal = await prisma.deal.findUnique({
    where: { orderNo: t.orderNo },
    select: { id: true, orderNo: true, status: true, valueMinor: true, currency: true, noPaymentWaiver: true },
  });
  if (!deal) { console.log(`#${t.orderNo}: NOT FOUND — skipped`); continue; }

  if (!deal.noPaymentWaiver && Number(deal.valueMinor) === t.expectedGrossMinor) {
    console.log(`#${t.orderNo}: already repaired (value=${Number(deal.valueMinor)}, no waiver) — no-op`);
    continue;
  }
  if (!deal.noPaymentWaiver) {
    console.log(`#${t.orderNo}: NO waiver but value=${Number(deal.valueMinor)} ≠ expected ${t.expectedGrossMinor} — MANUAL REVIEW, skipped`);
    continue;
  }

  const lines = await loadGroupTicketLines(prisma, deal.id);
  const gross = lines.reduce((n, l) => n + (l.quantity || 0) * (Number(l.unitPriceMinor) || 0), 0);
  if (gross !== t.expectedGrossMinor) {
    console.log(`#${t.orderNo}: recomputed gross ${gross} ≠ audited evidence ${t.expectedGrossMinor} — ABORTED for this deal`);
    continue;
  }

  console.log(`#${t.orderNo}: value ${Number(deal.valueMinor)} → ${gross} agorot (invrec #${t.invrec} matches). ${APPLY ? 'APPLYING' : 'dry-run only'}`);
  if (!APPLY) continue;

  const origin = systemOrigin();
  const before = { id: deal.id, valueMinor: deal.valueMinor, currency: deal.currency };

  await prisma.$transaction(async (tx) => {
    // Canonical waiver CANCEL: valueMinor := gross, noPaymentWaiver := null,
    // pinned note evolves, waiver_updated timeline event.
    await reconcileWaiverAfterSave(tx, {
      dealId: deal.id,
      waiver: deal.noPaymentWaiver,
      grossMinor: gross,
      decision: 'cancel',
      origin,
    });
    // The registration row is honest: the money is real (external card charge +
    // issued invrec) — it was never a fee waiver. noPaymentReason text is kept
    // as the historical explanation of WHY no GOS payment row exists.
    await tx.ticketRegistration.updateMany({
      where: { dealId: deal.id, paymentStatus: 'waived' },
      data: { paymentStatus: 'paid' },
    });
    // Clear internal system note documenting the repair (audit trail).
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: deal.id,
      kind: 'note',
      body:
        `<p><strong>תיקון מערכת:</strong> הדיל נרשם לסיור דרך מסלול "ללא תשלום" למרות שהלקוח שילם באשראי מחוץ למערכת (קארדקום/אישורית).</p>` +
        `<p>המחיר המסחרי הוחזר ל־₪${(gross / 100).toLocaleString('he-IL')} על בסיס שורות המחיר בבילדר, בהתאמה מלאה לחשבונית מס/קבלה #${t.invrec} שכבר הופקה על אותו סכום.</p>` +
        `<p>לא בוצע שינוי ברישום לסיור, במשתתפים או במסמכים.</p>`,
      data: { event: 'price_repair', restoredValueMinor: gross, invrec: t.invrec, reason: 'external_payment_mislabeled_as_free' },
      origin,
    });
  });

  // Changelog row for the price change (post-commit, canonical writer).
  await recordDealChanges(prisma, {
    dealId: deal.id,
    before,
    after: { ...before, valueMinor: BigInt(gross) },
    origin,
  });
  console.log(`#${t.orderNo}: repaired.`);
}

await prisma.$disconnect();
