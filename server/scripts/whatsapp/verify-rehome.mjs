// Independent post-re-home verification — deliberately NOT the same code that
// performed the move. Re-reads production and checks the things a successful
// UPDATE can still leave wrong: orphaned cross-table references, R2 media keys
// that still carry the old account in their path, and configured send
// destinations (Communication Center / Admin Reports) that now point at an
// account which no longer owns the chats.
//
//   node scripts/whatsapp/verify-rehome.mjs --old=office --new=main

import { PrismaClient } from '@prisma/client';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }),
);
const OLD = String(args.old || 'office');
const NEW = String(args.new || 'main');

const prisma = new PrismaClient();
const problems = [];
const note = (s) => problems.push(s);

// 1. Ownership.
const chats = await prisma.whatsAppChat.groupBy({ by: ['accountId'], _count: { _all: true } });
const msgs = await prisma.whatsAppMessage.groupBy({ by: ['accountId'], _count: { _all: true } });
console.log('chats by account:   ', JSON.stringify(chats));
console.log('messages by account:', JSON.stringify(msgs));

// 2. A message must live on the same account as its chat. accountId is
//    denormalised on the message, so a partial move would show up here.
const mismatched = await prisma.$queryRaw`
  select count(*)::int n from "WhatsAppMessage" m
  join "WhatsAppChat" c on c.id = m."chatId"
  where m."accountId" <> c."accountId"`;
console.log('message/chat account mismatches:', mismatched[0].n);
if (mismatched[0].n > 0) note(`${mismatched[0].n} messages disagree with their chat's account`);

// 3. Account rows.
for (const a of await prisma.whatsAppAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })) {
  console.log(`account ${a.id.padEnd(8)} sortOrder=${a.sortOrder} status=${String(a.status).padEnd(13)} phoneJid=${a.phoneJid || 'null'}  ${a.label}`);
}
const oldRow = await prisma.whatsAppAccount.findUnique({ where: { id: OLD } });
if (oldRow?.phoneJid) note(`'${OLD}' still carries phoneJid ${oldRow.phoneJid}`);

// 4. R2 media keys embed the account: whatsapp/<accountId>/… . The objects are
//    NOT moved (that would mean copying every blob); the stored key still
//    resolves, so viewing/downloading works. It only matters for the purge
//    contract, which deletes by prefix.
const staleKeys = await prisma.whatsAppMessage.count({
  where: { accountId: NEW, mediaKey: { startsWith: `whatsapp/${OLD}/` } },
});
const totalMedia = await prisma.whatsAppMessage.count({ where: { accountId: NEW, mediaKey: { not: null } } });
console.log(`media rows on '${NEW}': ${totalMedia} (with '${OLD}' R2 prefix: ${staleKeys})`);
if (staleKeys > 0) note(`${staleKeys} media objects still sit under R2 prefix whatsapp/${OLD}/ — reads work, prefix-purge would mis-target`);

// 5. Configured send destinations that name an account.
const commMsgs = await prisma.communicationMessage.findMany({
  where: { waAccountId: { not: null } },
  select: { id: true, waAccountId: true, internalName: true, publicNumber: true, status: true },
});
console.log(`communication messages pinned to an account: ${commMsgs.length}`);
for (const m of commMsgs) {
  console.log(`  #${m.publicNumber} ${m.waAccountId}  [${m.status}]  ${m.internalName}`);
  if (m.waAccountId === OLD) note(`communication message #${m.publicNumber} "${m.internalName}" still sends from '${OLD}'`);
}

// 6. Admin report destinations.
const reports = await prisma.adminReportConfig.findMany({
  where: { waAccountId: { not: null } },
  select: { reportNumber: true, waAccountId: true, enabled: true },
});
for (const r of reports) {
  console.log(`  admin report #${r.reportNumber} → ${r.waAccountId} (enabled=${r.enabled})`);
  if (r.waAccountId === OLD) note(`admin report #${r.reportNumber} still sends from '${OLD}'`);
}

// 6b. Admin reports address a SPECIFIC chat (waChatId) on their configured
//     account. Moving the chats means a config still naming the old account can
//     no longer reach them — dispatch refuses on chat.accountId !== waAccountId.
for (const r of await prisma.adminReportConfig.findMany({
  where: { waChatId: { not: null } },
  select: { reportNumber: true, waAccountId: true, waChatId: true, enabled: true },
})) {
  const chat = await prisma.whatsAppChat.findUnique({
    where: { id: r.waChatId },
    select: { accountId: true, phoneNumber: true, groupSubject: true },
  });
  const state = !chat
    ? 'CHAT ROW MISSING'
    : chat.accountId !== r.waAccountId
      ? `chat now on '${chat.accountId}' — dispatch will refuse`
      : 'ok';
  console.log(`  report #${r.reportNumber} enabled=${r.enabled} account=${r.waAccountId} chat=${r.waChatId} → ${state}`);
  if (r.enabled && state !== 'ok') note(`admin report #${r.reportNumber}: ${state}`);
}

// 7. Scheduled messages / tasks referencing the old account.
const sched = await prisma.whatsAppScheduledMessage.count({ where: { accountId: OLD } });
if (sched > 0) note(`${sched} scheduled messages still on '${OLD}'`);

console.log('\n' + (problems.length ? 'FOLLOW-UPS:' : 'CLEAN — no follow-ups.'));
for (const p of problems) console.log('  • ' + p);
await prisma.$disconnect();
