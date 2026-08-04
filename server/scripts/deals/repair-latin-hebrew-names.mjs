// Slice F repair — ingress-created contacts whose HEBREW name fields hold a
// FULLY-Latin name (Meta leads submitting English names) while the English
// fields are empty. Only that unambiguous case is corrected — mixed or
// ambiguous names are reported, never guessed. Uses THE canonical classifier
// (shared/nameLanguage.mjs). Raw ingress payloads stay untouched on
// IngressEvent (audit history preserved).
//
// Dry-run:  DATABASE_URL=<prod> node server/scripts/deals/repair-latin-hebrew-names.mjs
// Apply:    DATABASE_URL=<prod> node server/scripts/deals/repair-latin-hebrew-names.mjs --apply
import { PrismaClient } from '@prisma/client';
import { classifyNameScript } from '../../../shared/nameLanguage.mjs';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// Contacts born from ingress (the affected cohort), newest first.
const events = await prisma.ingressEvent.findMany({
  where: { status: 'processed', contactId: { not: null } },
  select: { contactId: true, source: true, receivedAt: true },
  orderBy: { receivedAt: 'desc' },
});
const sourceByContact = new Map();
for (const e of events) if (!sourceByContact.has(e.contactId)) sourceByContact.set(e.contactId, e.source);

const contacts = await prisma.contact.findMany({
  where: { id: { in: [...sourceByContact.keys()] } },
  select: { id: true, contactNo: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
});

const unambiguous = [];
const mixed = [];
for (const c of contacts) {
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  const en = `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
  if (!he) continue;
  const cls = classifyNameScript(he);
  if (cls === 'en' && !en) unambiguous.push(c);
  else if (cls === 'mixed') mixed.push(c);
}

console.log(`ingress-created contacts scanned: ${contacts.length}`);
console.log(`UNAMBIGUOUS (fully-Latin Hebrew name, English empty): ${unambiguous.length}`);
const bySource = {};
for (const c of unambiguous) {
  const s = sourceByContact.get(c.id) || '?';
  bySource[s] = (bySource[s] || 0) + 1;
}
console.log('by ingress source:', JSON.stringify(bySource));
console.log('examples:');
for (const c of unambiguous.slice(0, 15)) {
  console.log(`  #${c.contactNo ?? c.id}: "${c.firstNameHe} ${c.lastNameHe}".trim() → EN fields`);
}
console.log(`MIXED (reported only, never repaired): ${mixed.length}`);
for (const c of mixed.slice(0, 10)) console.log(`  #${c.contactNo ?? c.id}: "${c.firstNameHe} ${c.lastNameHe}"`);

if (APPLY) {
  let moved = 0;
  for (const c of unambiguous) {
    await prisma.contact.update({
      where: { id: c.id },
      data: {
        firstNameEn: c.firstNameHe || '',
        lastNameEn: c.lastNameHe || '',
        firstNameHe: '',
        lastNameHe: '',
      },
    });
    moved += 1;
  }
  console.log(`APPLIED: moved ${moved} contacts' names He→En`);
}
await prisma.$disconnect();
