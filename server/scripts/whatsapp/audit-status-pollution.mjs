// READ-ONLY forensic audit for the WhatsApp Status ingestion incident.
//
// WhatsApp Status posts (msg.key.remoteJid === 'status@broadcast'), broadcast
// lists (*@broadcast) and channels (*@newsletter) were never a real CRM
// conversation, but before the ingestion-boundary fix they were ingested as
// normal messages. Because ingest resolved the private chat by the STATUS
// AUTHOR'S phone (senderPn), a status post could even be merged into that
// person's genuine DM thread and auto-linked to their Contact.
//
// The reliable forensic marker is the stored rawPayload: its key.remoteJid is
// the ORIGINAL WhatsApp jid, regardless of which chat row the message landed
// in. This script only COUNTS and LISTS — it writes nothing. Its output is the
// input to the (separate, gated) cleanup script.
//
//   railway run --service Grafitiyul-OS node server/scripts/whatsapp/audit-status-pollution.mjs
//   (add --sample to also print up to 20 example rows per account)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SAMPLE = process.argv.includes('--sample');

// rawPayload->'key'->>'remoteJid' matches an excluded jid. Kept in ONE place.
const EXCLUDED_SQL = `(
  payload->'key'->>'remoteJid' = 'status@broadcast'
  OR payload->'key'->>'remoteJid' LIKE '%@broadcast'
  OR payload->'key'->>'remoteJid' LIKE '%@newsletter'
)`;

function line(label, value) {
  console.log(`  ${label.padEnd(52)} ${value}`);
}

async function main() {
  console.log('\n=== WhatsApp Status pollution audit (READ-ONLY) ===\n');

  // 1) Proven status-origin MESSAGES (forensic: original remoteJid), per account.
  const msgByAccount = await prisma.$queryRawUnsafe(`
    SELECT m."accountId" AS account,
           COUNT(*)::int AS msg_count,
           COUNT(DISTINCT m."chatId")::int AS chat_count,
           MIN(m."timestampFromSource") AS first_at,
           MAX(m."timestampFromSource") AS last_at
    FROM "WhatsAppMessage" m,
         LATERAL (SELECT m."rawPayload" AS payload) p
    WHERE ${EXCLUDED_SQL}
    GROUP BY m."accountId"
    ORDER BY msg_count DESC
  `);

  let totalMsgs = 0;
  let totalChats = 0;
  if (msgByAccount.length === 0) {
    console.log('  No status-origin messages found. Nothing to clean.\n');
  }
  for (const r of msgByAccount) {
    console.log(`Account: ${r.account}`);
    line('status-origin messages stored', r.msg_count);
    line('distinct chats they landed in', r.chat_count);
    line('first / last', `${r.first_at?.toISOString?.() ?? r.first_at}  →  ${r.last_at?.toISOString?.() ?? r.last_at}`);
    totalMsgs += r.msg_count;
    totalChats += r.chat_count;
    console.log('');
  }

  // 2) Chats that contain status-origin messages — how many are pure-status
  //    (every message is status → chat is safe to delete) vs mixed (status
  //    merged into a REAL conversation → only the status rows get removed and
  //    lastMessageAt/unread must be recomputed).
  const chatBreakdown = await prisma.$queryRawUnsafe(`
    WITH per_chat AS (
      SELECT m."chatId" AS chat_id,
             COUNT(*) FILTER (WHERE ${EXCLUDED_SQL})::int AS status_msgs,
             COUNT(*)::int AS total_msgs
      FROM "WhatsAppMessage" m,
           LATERAL (SELECT m."rawPayload" AS payload) p
      GROUP BY m."chatId"
      HAVING COUNT(*) FILTER (WHERE ${EXCLUDED_SQL}) > 0
    )
    SELECT
      COUNT(*)::int AS affected_chats,
      COUNT(*) FILTER (WHERE status_msgs = total_msgs)::int AS pure_status_chats,
      COUNT(*) FILTER (WHERE status_msgs < total_msgs)::int AS mixed_chats
    FROM per_chat
  `);
  const cb = chatBreakdown[0] ?? { affected_chats: 0, pure_status_chats: 0, mixed_chats: 0 };

  // 3) Chats whose OWN externalChatId is an excluded jid (pure status rows).
  const excludedChatIdRows = await prisma.whatsAppChat.findMany({
    where: {
      OR: [
        { externalChatId: 'status@broadcast' },
        { externalChatId: { endsWith: '@broadcast' } },
        { externalChatId: { endsWith: '@newsletter' } },
      ],
    },
    select: { id: true, accountId: true, externalChatId: true, contactId: true },
  });

  // 4) Contact / Deal linkage caused by pollution. A chat is "linked" if it has
  //    a contactId; deals are derived contact→DealContact.
  const affectedChatIds = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT m."chatId" AS chat_id
    FROM "WhatsAppMessage" m,
         LATERAL (SELECT m."rawPayload" AS payload) p
    WHERE ${EXCLUDED_SQL}
  `);
  const chatIds = affectedChatIds.map((r) => r.chat_id);
  const linkedChats = chatIds.length
    ? await prisma.whatsAppChat.findMany({
        where: { id: { in: chatIds }, contactId: { not: null } },
        select: { id: true, contactId: true, matchSource: true, type: true, externalChatId: true },
      })
    : [];
  const linkedContactIds = [...new Set(linkedChats.map((c) => c.contactId))];
  const dealLinks = linkedContactIds.length
    ? await prisma.dealContact.findMany({
        where: { contactId: { in: linkedContactIds } },
        select: { dealId: true },
      })
    : [];
  const dealIds = [...new Set(dealLinks.map((d) => d.dealId))];

  console.log('--- Totals ---');
  line('total status-origin messages', totalMsgs);
  line('affected chats (contain ≥1 status message)', cb.affected_chats);
  line('  ↳ pure-status chats (safe to DELETE whole)', cb.pure_status_chats);
  line('  ↳ mixed chats (delete rows + recompute)', cb.mixed_chats);
  line('chats keyed by an excluded jid', excludedChatIdRows.length);
  line('affected chats auto-linked to a Contact', linkedChats.length);
  line('distinct Contacts polluted', linkedContactIds.length);
  line('distinct Deals reachable via those Contacts', dealIds.length);
  console.log('');
  console.log('  Timeline / Task / notification side effects: inbound WhatsApp');
  console.log('  ingest writes ONLY WhatsAppChat/WhatsAppMessage rows — it creates');
  console.log('  no Timeline entries, Tasks, or notifications (verified in code).');
  console.log('  So status traffic could pollute chats/contacts but triggered none');
  console.log('  of those. Confirm against your data if any automation was added.');
  console.log('');

  if (SAMPLE) {
    console.log('--- Sample rows (up to 20) ---');
    const sample = await prisma.$queryRawUnsafe(`
      SELECT m."accountId" AS account, m."chatId" AS chat_id,
             p.payload->'key'->>'remoteJid' AS remote_jid,
             m."senderPhone" AS sender_phone, m."messageType" AS type,
             m."timestampFromSource" AS at
      FROM "WhatsAppMessage" m,
           LATERAL (SELECT m."rawPayload" AS payload) p
      WHERE ${EXCLUDED_SQL}
      ORDER BY m."timestampFromSource" DESC
      LIMIT 20
    `);
    for (const r of sample) {
      console.log(`  ${r.account} | ${r.remote_jid} | ${r.type} | sender=${r.sender_phone ?? '—'} | ${r.at?.toISOString?.() ?? r.at}`);
    }
    console.log('');
  }

  console.log('Read-only audit complete. No rows were modified.\n');
}

main()
  .catch((err) => {
    console.error('audit failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
