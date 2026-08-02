// PRODUCTION verification for AUT-004 — drives ONE clearly-marked test lead
// through the CANONICAL ingress pipeline (the exact code path a real external
// lead takes), then verifies the whole chain:
//   ingest → Deal created → AUT-004 run (idempotent) → Communication Center
//   delivery on the unified queue → (sent by the deployed worker).
// Then repeats the SAME ingest call to prove a retried creation request is a
// duplicate and can never notify twice.
//
// Cleanup: marks the test deal LOST with an explicit test note (the normal
// business way to close a dead lead) — nothing is deleted.
//
// Run (from server/):  DB_URL=<postgres url> node scripts/verify-aut004-test-lead.mjs

const dbUrl = process.env.DB_URL || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error('No DB_URL'); process.exit(1); }
process.env.DATABASE_URL = dbUrl;

await import('../src/automations/definitions/index.js');
const { prisma } = await import('../src/db.js');
const { buildEvent } = await import('../src/ingress/contract.js');
const { receiveEvent, processEvent } = await import('../src/ingress/pipeline.js');
const { PrismaClient } = await import('@prisma/client');

// This script talks to prod over the PUBLIC url — far higher latency than the
// server's private network, so the pipeline's interactive transaction needs a
// generous timeout (the deployed server keeps its defaults).
const db = new PrismaClient({
  datasources: { db: { url: dbUrl } },
  transactionOptions: { timeout: 120000, maxWait: 30000 },
});

const TEST_TAG = 'gos-aut004-prod-verify-1';

const canonical = () => buildEvent({
  kind: 'lead',
  source: 'website_form',
  sourceKey: 'gos-production-test',
  externalId: TEST_TAG,
  person: {
    fullName: 'בדיקת מערכת — ליד ניסיון GOS',
    firstName: 'בדיקת',
    lastName: 'מערכת GOS',
    phone: '0520000199',
    email: 'gos-test-lead@grafitiyul.co.il',
  },
  context: {
    formName: 'GOS production verification (safe test lead)',
    message: 'ליד בדיקה של מערכת GOS — לא לקוח אמיתי. נסגר אוטומטית כ"אבוד" מיד לאחר האימות.',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('── 1. ingest (canonical pipeline) ──');
  const { event, duplicate } = await receiveEvent({
    source: 'website_form',
    sourceKey: 'gos-production-test',
    externalId: TEST_TAG,
    rawPayload: { test: true, tag: TEST_TAG },
    idempotencyKey: TEST_TAG,
  }, db);
  console.log(`receive: event ${event.id} · duplicate=${duplicate} · status=${event.status}`);
  let first = { status: event.status, dealId: event.dealId };
  if (event.status !== 'processed') {
    first = await processEvent(event.id, { db, canonicalEvent: canonical() });
  }
  console.log('process #1:', JSON.stringify(first));
  const dealId = first.dealId;
  if (!dealId) { console.log('no deal — stopping'); return; }

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { orderNo: true, title: true, status: true } });
  console.log(`deal: #${deal.orderNo} · ${deal.title} · ${deal.status}`);

  console.log('── 2. automation run (fires detached — waiting) ──');
  let runs = [];
  for (let i = 0; i < 20 && !runs.length; i++) {
    await sleep(1500);
    runs = await prisma.automationRun.findMany({
      where: { autId: 'AUT-004', dealId },
      select: { id: true, status: true, reasonHe: true, idempotencyKey: true, actionResults: true },
    });
  }
  console.log(`AutomationRun rows: ${runs.length}`);
  for (const r of runs) console.log('  ', r.status, '·', r.idempotencyKey, '·', r.reasonHe);

  console.log('── 3. unified queue delivery ──');
  const deliveries = await prisma.communicationDelivery.findMany({
    where: { dealId },
    select: {
      id: true, status: true, triggerKey: true, intendedAt: true, effectiveAt: true,
      waitReason: true, lastError: true, renderedContent: true, messageNumber: true,
      event: { select: { internalName: true } },
    },
  });
  console.log(`CommunicationDelivery rows: ${deliveries.length}`);
  for (const d of deliveries) {
    console.log(`  מסר #${d.messageNumber} · ${d.event?.internalName} · ${d.status} · key ${d.triggerKey}`);
    console.log(`  intended ${d.intendedAt?.toISOString?.() || d.intendedAt} · wait: ${d.waitReason || '—'} · err: ${d.lastError || '—'}`);
  }

  console.log('── 4. retrying the SAME creation request (must not notify twice) ──');
  const retry = await receiveEvent({
    source: 'website_form',
    sourceKey: 'gos-production-test',
    externalId: TEST_TAG,
    rawPayload: { test: true, tag: TEST_TAG },
    idempotencyKey: TEST_TAG,
  }, db);
  console.log('ingest #2:', JSON.stringify({ duplicate: retry.duplicate, status: retry.event.status, dealId: retry.event.dealId }));
  const reprocess = await processEvent(retry.event.id, { db, canonicalEvent: canonical() });
  console.log('process #2 (must skip):', JSON.stringify(reprocess));
  await sleep(3000);
  const runs2 = await prisma.automationRun.count({ where: { autId: 'AUT-004', dealId } });
  const del2 = await prisma.communicationDelivery.count({ where: { dealId } });
  console.log(`after retry: AutomationRun=${runs2} (expect 1) · deliveries=${del2} (expect 1)`);

  console.log('── 5. waiting for the deployed worker to send (up to 3 min) ──');
  let sent = null;
  for (let i = 0; i < 18; i++) {
    await sleep(10000);
    sent = await prisma.communicationDelivery.findFirst({
      where: { dealId },
      select: { status: true, sentAt: true, waitReason: true, lastError: true, renderedContent: true, recipientSnapshot: true },
    });
    if (sent?.status === 'sent' || sent?.status === 'failed' || sent?.status === 'failed_final') break;
    console.log(`   status: ${sent?.status} · wait: ${sent?.waitReason || '—'}`);
  }
  console.log('final delivery status:', sent?.status, '· sentAt:', sent?.sentAt || '—');
  if (sent?.renderedContent?.body) {
    console.log('── rendered message body ──');
    console.log(sent.renderedContent.body);
  }

  console.log('── 6. closing the test lead (normal lost flow, nothing deleted) ──');
  await prisma.deal.update({
    where: { id: dealId },
    data: { status: 'lost', lostAt: new Date(), lostReason: 'ליד בדיקה של מערכת GOS — אימות אוטומציית AUT-004' },
  });
  await prisma.timelineEntry.create({
    data: {
      subjectType: 'deal', subjectId: dealId, kind: 'note', isSystem: true,
      actorType: 'system', actorLabel: 'GOS · אימות מערכת',
      body: '<p>ליד בדיקה — נוצר ונסגר אוטומטית במסגרת אימות אוטומציית AUT-004 (עדכון מנהלים על ליד חדש).</p>',
    },
  });
  console.log(`test deal #${deal.orderNo} closed as lost.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
