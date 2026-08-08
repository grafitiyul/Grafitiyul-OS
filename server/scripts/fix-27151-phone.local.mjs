// LOCAL, ONE-OFF: correct the canonical phone on Deal #27151's contact.
//
// ── The evidence, stated honestly ────────────────────────────────────────────
// The checkout did NOT declare a country. On both ingress events for Woo order
// 2261, `billing.country`, `billing.state`, `billing.postcode` and
// `shipping.country` are all empty strings, `customer_id` is 0 (guest, so there
// is no Woo customer record either) and there is no country/geo meta of any
// kind. So GOS does not KNOW the country from a country field — there isn't one.
//
// What GOS does hold, from the customer's own typed billing address:
//   billing.city      "Aix-En-Provence"           — a French commune
//   billing.address_1 "65 Rue de l'Hippodrome, A1" — a French street address
// and, as SUPPORTING validation only:
//   the phone is a well-formed French national mobile (06 + 8 digits) and is
//   NOT a valid Israeli subscriber number under the Israeli numbering plan.
//
// The number's 06 shape is NOT the country-identification source — the billing
// address is. The number only corroborates it.
//
// Run with --apply to write. Without it, prints what would change.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const APPLY = process.argv.includes('--apply');

// The RESTORED production database, by explicit service name. The damaged
// original service is never named here.
const RESTORED_SERVICE = 'Postgres-restored-20260808-1415';
const vars = JSON.parse(execFileSync('railway', ['variables', '--service', RESTORED_SERVICE, '--json'], {
  cwd: 'c:/Projects/grafitiyul-os', encoding: 'utf8', maxBuffer: 2e7, shell: true,
}));
const URL = vars.DATABASE_PUBLIC_URL;
if (!URL || URL.includes('nozomi.proxy.rlwy.net:57903')) {
  throw new Error('refusing to run: resolved the damaged database');
}

const require2 = createRequire('file:///c:/Projects/grafitiyul-os/server/');
const { PrismaClient } = require2('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });

const { normalizePhoneIntl, formatPhoneDisplay } = await import('file:///c:/Projects/grafitiyul-os/shared/phone.mjs');

const OLD = '0669129785';
const CANONICAL = '+33669129785';

const deal = await prisma.deal.findFirst({
  where: { orderNo: 27151 },
  select: { id: true, orderNo: true, contacts: { where: { isPrimary: true }, select: { contactId: true } } },
});
if (!deal) throw new Error('deal 27151 not found');
const contactId = deal.contacts[0]?.contactId;

const row = await prisma.contactPhone.findFirst({ where: { contactId, value: OLD } });
if (!row) {
  const current = await prisma.contactPhone.findMany({ where: { contactId }, select: { value: true } });
  console.log(`nothing to do — no phone "${OLD}" on this contact. Current: ${JSON.stringify(current)}`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log('BEFORE');
console.log(`  stored     : ${row.value}`);
console.log(`  normalizes : ${normalizePhoneIntl(row.value) ?? 'null (GOS cannot place it)'}`);
console.log(`  guide sees : ${formatPhoneDisplay(row.value)}`);
console.log('AFTER');
console.log(`  stored     : ${CANONICAL}`);
console.log(`  normalizes : ${normalizePhoneIntl(CANONICAL)}`);
console.log(`  guide sees : ${formatPhoneDisplay(CANONICAL)}`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  await prisma.$disconnect();
  process.exit(0);
}

// The SAME row is corrected — never a second ContactPhone. The customer has one
// phone number; what was wrong was how GOS wrote it down.
await prisma.contactPhone.update({ where: { id: row.id }, data: { value: CANONICAL } });

// An auditable trace on the deal an operator actually opens.
const { emitTimelineEvent, systemOrigin } = await import('file:///c:/Projects/grafitiyul-os/server/src/timeline/events.js');
await emitTimelineEvent(prisma, {
  subjectType: 'deal',
  subjectId: deal.id,
  kind: 'change',
  data: {
    changes: [{
      fieldKey: 'contactPhone',
      labelHe: 'טלפון הלקוח',
      oldValue: OLD,
      newValue: CANONICAL,
      oldDisplay: OLD,
      newDisplay: formatPhoneDisplay(CANONICAL),
    }],
    note:
      'תוקן לפי כתובת החיוב שהלקוחה הזינה באתר (Aix-En-Provence, 65 Rue de l\'Hippodrome) — '
      + 'צרפת. הקופה לא שלחה שדה מדינה, ולכן המספר נשמר קודם כמספר ישראלי שגוי.',
  },
  origin: systemOrigin(),
});

const after = await prisma.contactPhone.findUnique({ where: { id: row.id }, select: { value: true } });
console.log(`\nAPPLIED — stored value is now ${after.value}`);
await prisma.$disconnect();
