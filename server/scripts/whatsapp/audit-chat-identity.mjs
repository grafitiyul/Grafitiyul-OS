// Read-only audit of WhatsApp chat identity enrichment: which display-name
// tier each chat actually has, how many profile pictures landed, and how many
// chats COULD link to a GOS Contact by phone but have not.
//
//   node scripts/whatsapp/audit-chat-identity.mjs [--account=main]

import { PrismaClient } from '@prisma/client';
import { buildPhoneIndex, matchContactId, normalizePhoneIntl } from '../../src/whatsapp/phone.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }),
);
const ACCOUNT = String(args.account || 'main');

const prisma = new PrismaClient();
const chats = await prisma.whatsAppChat.findMany({
  where: { accountId: ACCOUNT },
  select: {
    id: true, type: true, externalChatId: true, phoneNumber: true, lidJid: true, phoneJid: true,
    savedContactName: true, pushName: true, groupSubject: true, profilePictureUrl: true,
    contactId: true, matchSource: true, lastMessageAt: true,
  },
});
console.log(`account '${ACCOUNT}': ${chats.length} chats\n`);

const pct = (n) => `${String(n).padStart(5)}  (${((n / chats.length) * 100).toFixed(1).padStart(5)}%)`;
console.log('IDENTITY COLUMNS POPULATED');
for (const f of ['savedContactName', 'pushName', 'groupSubject', 'profilePictureUrl', 'phoneNumber', 'lidJid', 'phoneJid', 'contactId']) {
  console.log(`  ${f.padEnd(20)} ${pct(chats.filter((c) => c[f]).length)}`);
}

// Which tier the UI actually renders (chatDisplayName order in routes/whatsapp.js):
// CRM contact → savedContactName → pushName → groupSubject → phoneNumber → null
console.log('\nDISPLAY-NAME TIER ACTUALLY USED');
const tiers = { crm_contact: 0, savedContactName: 0, pushName: 0, groupSubject: 0, phoneNumber: 0, none: 0 };
for (const c of chats) {
  if (c.contactId) tiers.crm_contact++;
  else if (c.savedContactName) tiers.savedContactName++;
  else if (c.pushName) tiers.pushName++;
  else if (c.groupSubject) tiers.groupSubject++;
  else if (c.phoneNumber) tiers.phoneNumber++;
  else tiers.none++;
}
for (const [k, v] of Object.entries(tiers)) console.log(`  ${k.padEnd(20)} ${pct(v)}`);

// The chats that DO have a picture — small enough to print.
const withPic = chats.filter((c) => c.profilePictureUrl);
console.log(`\nCHATS WITH A PROFILE PICTURE (${withPic.length})`);
for (const c of withPic.slice(0, 20)) {
  console.log(`  ${c.type.padEnd(7)} jid=${c.externalChatId}`);
  console.log(`          phone=${c.phoneNumber || '—'} saved=${c.savedContactName || '—'} push=${c.pushName || '—'} subject=${c.groupSubject || '—'}`);
  console.log(`          url=${String(c.profilePictureUrl).slice(0, 110)}`);
}

// Phone shape — an @lid privacy id yields digits that are NOT a phone number.
console.log('\nPHONE-NUMBER SHAPE (private chats)');
const priv = chats.filter((c) => c.type === 'private');
const shape = { normalizes: 0, unusable: 0, missing: 0, israeli: 0, foreign: 0 };
for (const c of priv) {
  if (!c.phoneNumber) { shape.missing++; continue; }
  const n = normalizePhoneIntl(c.phoneNumber);
  if (!n) { shape.unusable++; continue; }
  shape.normalizes++;
  if (n.startsWith('972')) shape.israeli++; else shape.foreign++;
}
console.log(`  private chats        ${String(priv.length).padStart(5)}`);
for (const [k, v] of Object.entries(shape)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(5)}`);

// How many private chats COULD deterministically link to a Contact right now?
const phones = await prisma.contactPhone.findMany({ select: { contactId: true, value: true } });
const index = buildPhoneIndex(phones);
console.log(`\nCONTACT MATCHING (index over ${phones.length} ContactPhone rows, ${index.size} distinct numbers)`);
let linked = 0, matchable = 0, ambiguous = 0, noOwner = 0, unusable = 0;
const samples = [];
for (const c of priv) {
  if (c.contactId) { linked++; continue; }
  const n = normalizePhoneIntl(c.phoneNumber);
  if (!n) { unusable++; continue; }
  const owners = index.get(n);
  if (!owners) { noOwner++; continue; }
  if (owners.size !== 1) { ambiguous++; continue; }
  matchable++;
  if (samples.length < 10) samples.push({ phone: n, contactId: matchContactId(n, index) });
}
console.log(`  already linked                 ${String(linked).padStart(5)}`);
console.log(`  MATCHABLE but not linked       ${String(matchable).padStart(5)}   <- auto-matcher would link these`);
console.log(`  ambiguous (shared number)      ${String(ambiguous).padStart(5)}`);
console.log(`  no GOS contact owns the number ${String(noOwner).padStart(5)}`);
console.log(`  phone unusable/missing         ${String(unusable).padStart(5)}`);
if (samples.length) {
  console.log('  sample matchable:');
  for (const s of samples) console.log(`    ${s.phone} -> contact ${s.contactId}`);
}

await prisma.$disconnect();
