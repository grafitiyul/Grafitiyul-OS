// Identity reconciliation sweep — the WhatsApp-finalization audit.
//
// SAFE repairs (only with --apply; each is idempotent and uses the SAME rule
// the production read-time path uses, so this can never do something the app
// wouldn't do on its own):
//   R1. exactly-one phone auto-match for unlinked private chats
//       (matchSource='phone' — identical to routes/whatsapp.js autoMatchChats)
//
// Everything else is REPORT-ONLY: ambiguity is a human decision by design
// (the no-guessing rule), so duplicates/conflicts are listed, never touched.
//
//   node scripts/whatsapp/reconcile-identity.mjs [--account=main] [--apply]

import { PrismaClient } from '@prisma/client';
import { buildPhoneIndex, matchContactId, normalizePhoneIntl } from '../../src/whatsapp/phone.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }),
);
const ACCOUNT = String(args.account || 'main');
const APPLY = args.apply === true || args.apply === 'true';

const prisma = new PrismaClient();
const manual = [];

console.log(`=== identity reconciliation — account '${ACCOUNT}' ${APPLY ? '(APPLY safe repairs)' : '(report only)'} ===\n`);

const chats = await prisma.whatsAppChat.findMany({
  where: { accountId: ACCOUNT },
  select: {
    id: true, type: true, externalChatId: true, phoneNumber: true, lidJid: true, phoneJid: true,
    savedContactName: true, pushName: true, groupSubject: true, contactId: true, matchSource: true,
    lastMessageAt: true,
  },
});
const priv = chats.filter((c) => c.type === 'private');
const groups = chats.filter((c) => c.type === 'group');
console.log(`chats: ${chats.length} (${priv.length} private, ${groups.length} groups)`);

// ── R1: exactly-one auto-match (safe repair) ────────────────────────────────
const phones = await prisma.contactPhone.findMany({ select: { contactId: true, value: true } });
const index = buildPhoneIndex(phones);
const matchable = [];
for (const c of priv) {
  if (c.contactId || !c.phoneNumber) continue;
  const cid = matchContactId(normalizePhoneIntl(c.phoneNumber), index);
  if (cid) matchable.push({ chatId: c.id, phone: c.phoneNumber, contactId: cid });
}
console.log(`\nR1 exactly-one matchable but unlinked: ${matchable.length}`);
if (APPLY && matchable.length) {
  for (const m of matchable) {
    await prisma.whatsAppChat.update({
      where: { id: m.chatId },
      data: { contactId: m.contactId, matchSource: 'phone' },
    });
  }
  console.log(`   → linked ${matchable.length} (matchSource='phone')`);
}

// ── A1: LID/PN duplicate chat rows (same person twice) ──────────────────────
const byPhone = new Map();
for (const c of priv) {
  if (!c.phoneNumber) continue;
  if (!byPhone.has(c.phoneNumber)) byPhone.set(c.phoneNumber, []);
  byPhone.get(c.phoneNumber).push(c);
}
const dupChats = [...byPhone.entries()].filter(([, list]) => list.length > 1);
console.log(`\nA1 duplicate private chats per phone: ${dupChats.length}`);
for (const [phone, list] of dupChats) {
  manual.push(`duplicate chats for ${phone}: ${list.map((c) => c.externalChatId).join(' + ')} — bridge merge should self-heal on next message; if not, merge manually`);
}

// ── A2: contacts sharing a phone (ambiguous — blocks auto-matching) ────────
const shared = [...index.entries()].filter(([, owners]) => owners.size > 1);
const sharedTouchingChats = shared.filter(([p]) => byPhone.has(p));
console.log(`A2 phones owned by >1 contact: ${shared.length} total, ${sharedTouchingChats.length} with an active chat`);
for (const [p, owners] of sharedTouchingChats) {
  manual.push(`phone ${p} owned by ${owners.size} contacts (${[...owners].join(', ')}) — its chat stays unmatched until a human merges/links`);
}

// ── A3: unresolvable identities (LID-only, no phone) ────────────────────────
const lidOnly = priv.filter((c) => !c.phoneNumber && c.lidJid);
console.log(`A3 LID-only chats (no phone resolved yet): ${lidOnly.length}`);
if (lidOnly.length) {
  manual.push(`${lidOnly.length} chats carry only a privacy id — phone arrives via lid→pn mapping on their next live message; no action possible now`);
}

// ── A4: nameless chats (display anonymity) ──────────────────────────────────
const nameless = priv.filter((c) => !c.contactId && !c.savedContactName && !c.pushName);
const namelessGroups = groups.filter((g) => !g.groupSubject);
console.log(`A4 private chats with no name source (phone-only display): ${nameless.length}; groups without subject: ${namelessGroups.length}`);

// ── A5: stale links (contact deleted → SetNull leaves matchSource behind) ──
const staleSource = await prisma.whatsAppChat.count({
  where: { accountId: ACCOUNT, contactId: null, matchSource: { not: null } },
});
console.log(`A5 chats with matchSource but no contact (stale after unlink/delete): ${staleSource}`);
if (APPLY && staleSource) {
  const r = await prisma.whatsAppChat.updateMany({
    where: { accountId: ACCOUNT, contactId: null, matchSource: { not: null } },
    data: { matchSource: null },
  });
  console.log(`   → cleared matchSource on ${r.count} rows (repair: flag without link is meaningless)`);
}

// ── A6: group messages with no sender identity ──────────────────────────────
const anonGroupMsgs = await prisma.whatsAppMessage.count({
  where: {
    accountId: ACCOUNT, direction: 'incoming', senderPhone: null, senderName: null,
    chat: { type: 'group' },
  },
});
console.log(`A6 group messages with no sender identity: ${anonGroupMsgs} (historical; UI shows the honest fallback — no backfill possible)`);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== MANUAL-REVIEW ITEMS (${manual.length}) ===`);
for (const m of manual) console.log('  • ' + m);
if (!manual.length) console.log('  none');
await prisma.$disconnect();
