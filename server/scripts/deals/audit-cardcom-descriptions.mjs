// READ-ONLY: audit existing Cardcom PaymentRequests' English descriptions
// against the NEW product-only rule (Product.nameEn). Reports which
// auto-derived pending rows will self-heal on next read (the sync-on-read
// keeps 'auto' rows equal to the canonical label) and which are operator
// overrides / frozen paid rows (never touched). Also verifies #26617.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.paymentRequest.findMany({
  where: { provider: 'cardcom' },
  select: {
    id: true, status: true, productDescriptionEn: true, productDescriptionSource: true,
    deal: { select: { orderNo: true, product: { select: { nameEn: true } }, productVariant: { select: { agentDisplayNameEn: true } } } },
  },
  orderBy: { createdAt: 'asc' },
});
for (const r of rows) {
  const canonical = String(r.deal?.product?.nameEn || '').trim() || null;
  const matches = canonical && r.productDescriptionEn === canonical;
  const willHeal = ['pending', 'awaiting_payment'].includes(r.status) && r.productDescriptionSource !== 'operator' && canonical && !matches;
  console.log(
    `#${r.deal?.orderNo} [${r.status}/${r.productDescriptionSource}] "${r.productDescriptionEn}" | Product.nameEn="${canonical}" | ${matches ? 'OK' : willHeal ? 'WILL SELF-HEAL on next read' : r.status === 'paid' ? 'frozen (paid)' : 'operator/manual'}`,
  );
}
await prisma.$disconnect();
