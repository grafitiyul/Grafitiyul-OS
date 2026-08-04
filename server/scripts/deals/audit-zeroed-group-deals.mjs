// READ-ONLY production audit for Deals #26210 / #26618 — group registrations
// whose payable total was zeroed by the register-without-payment waiver path.
// Prints everything needed to prove the original commercial price.
//
// Run: DATABASE_URL=<prod> node server/scripts/deals/audit-zeroed-group-deals.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORDER_NOS = (process.argv[2] ? process.argv[2].split(',').map(Number) : [26210, 26618]);

function j(x) {
  return JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);
}

for (const orderNo of ORDER_NOS) {
  const deal = await prisma.deal.findUnique({
    where: { orderNo },
    select: {
      id: true, orderNo: true, title: true, status: true, valueMinor: true, discountMinor: true,
      noPaymentWaiver: true, wonAt: true, createdAt: true, updatedAt: true,
      dealStage: { select: { key: true, label: true } },
      product: { select: { nameHe: true, nameEn: true } },
      productVariant: { select: { id: true } },
    },
  });
  if (!deal) { console.log(`\n===== #${orderNo}: NOT FOUND =====`); continue; }
  console.log(`\n===== Deal #${orderNo} (${deal.id}) =====`);
  console.log(j({ ...deal, valueMinor: Number(deal.valueMinor) }));

  const regs = await prisma.ticketRegistration.findMany({
    where: { dealId: deal.id },
    select: {
      id: true, tourEventId: true, status: true, quantity: true, source: true,
      paymentStatus: true, noPaymentReason: true, ticketBreakdown: true,
      createdAt: true, heldAt: true, confirmedAt: true, cancelledAt: true,
      tourEvent: { select: { id: true, date: true, startTime: true, status: true, product: { select: { nameHe: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log('--- ticketRegistrations ---');
  console.log(j(regs));

  const versions = await prisma.quoteVersion.findMany({
    where: { dealId: deal.id },
    select: { id: true, isWorking: true, createdAt: true, updatedAt: true, sourceKind: true, vatMode: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('--- quoteVersions ---');
  console.log(j(versions));
  for (const v of versions) {
    const lines = await prisma.quoteLine.findMany({
      where: { quoteVersionId: v.id },
      select: {
        id: true, sourceKind: true, sourceCardGroupId: true, ticketTypeId: true, active: true,
        quantity: true, unitPriceMinor: true, sortOrder: true,
        ticketType: { select: { nameHe: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    console.log(`--- lines of version ${v.id} (working=${v.isWorking}) ---`);
    console.log(j(lines));
  }

  const links = await prisma.dealPaymentLink.findMany({
    where: { dealId: deal.id },
    select: { id: true, status: true, amountMinor: true, createdAt: true, provider: true, productName: true },
  }).catch((e) => `dealPaymentLink query failed: ${e.message}`);
  console.log('--- dealPaymentLinks ---');
  console.log(j(links));

  const docs = await prisma.icountDocument.findMany({
    where: { dealId: deal.id },
    select: { id: true, doctype: true, docnum: true, status: true, amountMinor: true, source: true, createdAt: true },
  }).catch((e) => `icountDocument query failed: ${e.message}`);
  console.log('--- icountDocuments ---');
  console.log(j(docs));

  const evidence = await prisma.dealCollectionEvidence.findMany({
    where: { dealId: deal.id },
  }).catch((e) => `evidence query failed: ${e.message}`);
  console.log('--- dealCollectionEvidence ---');
  console.log(j(evidence));

  const timeline = await prisma.timelineEntry.findMany({
    where: { subjectType: 'deal', subjectId: deal.id },
    select: { id: true, kind: true, body: true, data: true, isPinned: true, createdAt: true, deletedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('--- timeline ---');
  for (const t of timeline) {
    console.log(`[${t.createdAt.toISOString()}] kind=${t.kind} pinned=${t.isPinned} del=${!!t.deletedAt} event=${t.data?.event || ''}`);
    if (t.body) console.log(`   body: ${String(t.body).slice(0, 300).replace(/\n/g, ' | ')}`);
    if (t.data && ['no_payment_won', 'waiver_updated', 'no_payment_note', 'hold_created', 'hold_updated'].includes(t.data?.event)) console.log(`   data: ${JSON.stringify(t.data)}`);
  }
}

await prisma.$disconnect();
