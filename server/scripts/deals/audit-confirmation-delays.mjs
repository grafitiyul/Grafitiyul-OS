// READ-ONLY production audit — confirmation-email delay trace for given deals.
// Prints ConfirmationEmailSend + ScheduledEmail rows with full timing fields.
// Run: DATABASE_URL=<prod> node server/scripts/deals/audit-confirmation-delays.mjs 26340,26107
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORDER_NOS = (process.argv[2] || '26340,26107').split(',').map(Number);

const j = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);

for (const orderNo of ORDER_NOS) {
  const deal = await prisma.deal.findUnique({
    where: { orderNo },
    select: { id: true, orderNo: true, status: true, wonAt: true },
  });
  if (!deal) { console.log(`#${orderNo}: NOT FOUND`); continue; }
  console.log(`\n===== Deal #${orderNo} (${deal.id}) status=${deal.status} wonAt=${deal.wonAt?.toISOString()} =====`);

  const sends = await prisma.confirmationEmailSend.findMany({
    where: { dealId: deal.id },
    select: {
      id: true, templateName: true, language: true, recipientSnapshot: true, subject: true,
      scheduledEmailId: true, createdById: true, createdAt: true, generationMeta: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`--- confirmationEmailSend rows (${sends.length}) ---`);
  for (const s of sends) {
    console.log(j({ ...s, bodyHtml: undefined, generationMeta: s.generationMeta ? { test: s.generationMeta.test } : null }));
  }

  const schedIds = sends.map((s) => s.scheduledEmailId).filter(Boolean);
  const sched = await prisma.scheduledEmail.findMany({
    where: { OR: [{ id: { in: schedIds } }, { dealId: deal.id }] },
    select: {
      id: true, accountId: true, subject: true, scheduledAt: true, status: true,
      attemptCount: true, lastAttemptAt: true, nextRetryAt: true, connectionDeferredCount: true,
      waitReason: true, effectiveAt: true, claimedAt: true, claimedBy: true, sentAt: true,
      gmailMessageId: true, failureReason: true, createdAt: true, updatedAt: true,
      account: { select: { emailAddress: true, healthState: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`--- scheduledEmail rows (${sched.length}) ---`);
  for (const s of sched) console.log(j(s));

  const timeline = await prisma.timelineEntry.findMany({
    where: { subjectType: 'deal', subjectId: deal.id, kind: { in: ['communication', 'email'] } },
    select: { kind: true, body: true, data: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('--- communication/email timeline ---');
  for (const t of timeline) console.log(`[${t.createdAt.toISOString()}] ${t.kind} ${t.data?.event || ''} ${String(t.body || '').slice(0, 120)}`);
}

// Queue context: what else was pending around those times?
const recent = await prisma.scheduledEmail.findMany({
  where: { createdAt: { gte: new Date(Date.now() - 3 * 24 * 3600 * 1000) } },
  select: { id: true, status: true, scheduledAt: true, claimedAt: true, sentAt: true, waitReason: true, effectiveAt: true, connectionDeferredCount: true, attemptCount: true, failureReason: true, createdAt: true, account: { select: { emailAddress: true, healthState: true } } },
  orderBy: { createdAt: 'asc' },
});
console.log(`\n===== last-72h ScheduledEmail rows (${recent.length}) =====`);
for (const s of recent) {
  const claimedDelay = s.claimedAt && s.scheduledAt ? Math.round((s.claimedAt - s.scheduledAt) / 1000) : null;
  const sentDelay = s.sentAt && s.scheduledAt ? Math.round((s.sentAt - s.scheduledAt) / 1000) : null;
  console.log(`${s.id} ${s.status} acct=${s.account?.emailAddress}(${s.account?.healthState}) sched=${s.scheduledAt?.toISOString()} claimed=${s.claimedAt?.toISOString() || '—'} sent=${s.sentAt?.toISOString() || '—'} claimDelay=${claimedDelay}s sentDelay=${sentDelay}s wait=${s.waitReason || '—'} eff=${s.effectiveAt?.toISOString() || '—'} connDef=${s.connectionDeferredCount} attempts=${s.attemptCount} fail=${s.failureReason || '—'}`);
}

await prisma.$disconnect();
