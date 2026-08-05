// Retroactive name-language repair across ALL production contacts (follow-up
// to the ingress-only pass). Deterministic corrections only, via THE canonical
// classifier (shared/nameLanguage.mjs):
//   • fully-LATIN name in the Hebrew pair + empty English pair → move He→En
//   • fully-HEBREW name in the English pair + empty Hebrew pair → move En→He
//   • MIXED names → never touched, reported
// Reports contacts repaired, deals affected (open/total), ambiguous skipped.
//
// Dry-run:  DATABASE_URL=<prod> node server/scripts/deals/repair-all-name-languages.mjs
// Apply:    DATABASE_URL=<prod> node server/scripts/deals/repair-all-name-languages.mjs --apply
import { PrismaClient } from '@prisma/client';
import { classifyNameScript } from '../../../shared/nameLanguage.mjs';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const contacts = await prisma.contact.findMany({
  select: {
    id: true, contactNo: true,
    firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
    dealContacts: { select: { deal: { select: { id: true, orderNo: true, status: true } } } },
  },
});

const heToEn = [];
const enToHe = [];
const mixed = [];
for (const c of contacts) {
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  const en = `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
  const heCls = he ? classifyNameScript(he) : 'empty';
  const enCls = en ? classifyNameScript(en) : 'empty';
  if (heCls === 'mixed' || enCls === 'mixed') { mixed.push(c); continue; }
  if (he && heCls === 'en' && !en) heToEn.push(c);
  else if (en && enCls === 'he' && !he) enToHe.push(c);
}

function dealStats(list) {
  const all = new Set();
  const open = new Set();
  for (const c of list) {
    for (const dc of c.dealContacts || []) {
      all.add(dc.deal.orderNo);
      if (dc.deal.status === 'open') open.add(dc.deal.orderNo);
    }
  }
  return { all: all.size, open: open.size };
}

console.log(`contacts scanned: ${contacts.length}`);
console.log(`He→En candidates (fully-Latin Hebrew name, English empty): ${heToEn.length}`);
console.log(`En→He candidates (fully-Hebrew English name, Hebrew empty): ${enToHe.length}`);
console.log(`MIXED skipped (never guessed): ${mixed.length}`);
const s1 = dealStats(heToEn); const s2 = dealStats(enToHe);
console.log(`deals linked to He→En candidates: ${s1.all} (open: ${s1.open})`);
console.log(`deals linked to En→He candidates: ${s2.all} (open: ${s2.open})`);
console.log('He→En examples:', heToEn.slice(0, 12).map((c) => `#${c.contactNo}:"${c.firstNameHe} ${c.lastNameHe}".trim()`).join(' | '));
console.log('En→He examples:', enToHe.slice(0, 12).map((c) => `#${c.contactNo}:"${c.firstNameEn} ${c.lastNameEn}".trim()`).join(' | '));
console.log('MIXED examples:', mixed.slice(0, 10).map((c) => `#${c.contactNo}:"${c.firstNameHe} ${c.lastNameHe}"/"${c.firstNameEn} ${c.lastNameEn}"`).join(' | '));

if (APPLY) {
  let moved = 0;
  for (const c of heToEn) {
    await prisma.contact.update({
      where: { id: c.id },
      data: { firstNameEn: c.firstNameHe || '', lastNameEn: c.lastNameHe || '', firstNameHe: '', lastNameHe: '' },
    });
    moved += 1;
  }
  for (const c of enToHe) {
    await prisma.contact.update({
      where: { id: c.id },
      data: { firstNameHe: c.firstNameEn || '', lastNameHe: c.lastNameEn || '', firstNameEn: '', lastNameEn: '' },
    });
    moved += 1;
  }
  console.log(`APPLIED: ${moved} contacts repaired (${heToEn.length} He→En, ${enToHe.length} En→He)`);
}
await prisma.$disconnect();
