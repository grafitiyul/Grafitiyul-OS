// READ-ONLY: why did Deal #26107 get no confirmation email on WON?
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const j = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);

const deal = await prisma.deal.findUnique({
  where: { orderNo: Number(process.argv[2] || 26107) },
  select: {
    id: true, orderNo: true, status: true, wonAt: true, communicationLanguage: true,
    confirmation: true,
    contacts: { select: { isPrimary: true, contact: { select: { firstNameHe: true, emails: true } } } },
  },
});
console.log(j(deal));

const reviews = await prisma.reviewItem.findMany({ where: { dealId: deal.id } });
console.log('--- reviewItems ---');
console.log(j(reviews));

const changes = await prisma.timelineEntry.findMany({
  where: { subjectType: 'deal', subjectId: deal.id, createdAt: { gte: new Date('2026-08-04T11:30:00Z') } },
  select: { kind: true, body: true, data: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
});
console.log('--- timeline since 11:30Z ---');
for (const t of changes) console.log(`[${t.createdAt.toISOString()}] ${t.kind} ${t.data?.event || ''} ${String(t.body || '').slice(0, 140)}`);
await prisma.$disconnect();
