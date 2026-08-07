// One-time production repair: sanitize every stored email address that carries
// invisible Unicode formatting characters, using THE canonical sanitizer.
//
// WHY: deals #27099/#27100 — a ContactEmail stored as 'hilah19@gmail.com' +
// U+200F made Gmail reject every confirmation send. A production sweep found 26
// such rows (25 from the legacy migration, 1 created live), attached to 143
// deals. Any of them reaching WON fails the same way.
//
// SAFETY
//   • DRY RUN BY DEFAULT. Pass --apply to write.
//   • Only ever REMOVES invisible formatting characters. The logical address is
//     preserved; a row whose sanitized value is empty or still unsendable is
//     REPORTED and left untouched (propose, never dispose).
//   • Idempotent: a second run finds nothing.
//   • Skips a repair that would collide with another address already on the
//     SAME owner (that is a duplicate to merge by hand, not to overwrite).
//
// USAGE
//   export DATABASE_URL="$(railway variables --service Postgres --json | …)"
//   node server/scripts/repair-email-addresses.mjs            # dry run
//   node server/scripts/repair-email-addresses.mjs --apply    # write

import { PrismaClient } from '@prisma/client';
import {
  sanitizeEmailAddress,
  normalizeEmailAddress,
  isEmailShaped,
  hasInvisibleChars,
} from '../../shared/emailAddress.mjs';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const codepoints = (s) =>
  [...String(s)].map((c) => {
    const cp = c.codePointAt(0);
    return cp > 126 ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : c;
  }).join('');

// Every table that stores an address. Adding a new one = one entry here.
const TARGETS = [
  { model: 'contactEmail', field: 'value', owner: 'contactId', label: 'ContactEmail' },
  { model: 'personRef', field: 'email', owner: 'id', label: 'PersonRef' },
  { model: 'signerPerson', field: 'email', owner: 'id', label: 'SignerPerson' },
  { model: 'emailAccount', field: 'emailAddress', owner: 'id', label: 'EmailAccount' },
];

const summary = { scanned: 0, dirty: 0, repaired: 0, skipped: [] };

for (const t of TARGETS) {
  const client = prisma[t.model];
  if (!client) {
    console.log(`— ${t.label}: model not present, skipped`);
    continue;
  }
  const rows = await client.findMany({
    select: { id: true, [t.field]: true, ...(t.owner !== 'id' ? { [t.owner]: true } : {}) },
  });
  summary.scanned += rows.length;
  const dirty = rows.filter((r) => hasInvisibleChars(r[t.field]));
  if (!dirty.length) {
    console.log(`✓ ${t.label}: ${rows.length} rows, none dirty`);
    continue;
  }
  summary.dirty += dirty.length;
  console.log(`\n${t.label}: ${dirty.length} dirty of ${rows.length}`);

  for (const row of dirty) {
    const raw = row[t.field];
    const clean = sanitizeEmailAddress(raw);
    const ownerId = t.owner === 'id' ? row.id : row[t.owner];

    if (!clean || !isEmailShaped(clean)) {
      summary.skipped.push({ table: t.label, id: row.id, raw: codepoints(raw), why: 'unsendable_after_sanitize' });
      console.log(`  ⚠ SKIP ${row.id} — still unusable after cleaning: ${codepoints(raw)}`);
      continue;
    }

    // Would this repair duplicate another address the same owner already has?
    if (t.owner !== 'id') {
      const siblings = await client.findMany({
        where: { [t.owner]: ownerId, id: { not: row.id } },
        select: { id: true, [t.field]: true },
      });
      const clash = siblings.find(
        (s) => normalizeEmailAddress(s[t.field]) === normalizeEmailAddress(clean),
      );
      if (clash) {
        summary.skipped.push({ table: t.label, id: row.id, raw: codepoints(raw), why: `duplicate_of_${clash.id}` });
        console.log(`  ⚠ SKIP ${row.id} — cleaning it would duplicate sibling ${clash.id} (merge by hand)`);
        continue;
      }
    }

    console.log(`  ${APPLY ? '✎' : '·'} ${row.id}  ${codepoints(raw)}  →  ${clean}`);
    if (APPLY) {
      await client.update({ where: { id: row.id }, data: { [t.field]: clean } });
      summary.repaired += 1;
    }
  }
}

// Frozen queue rows hold their own copy of the recipient — a repaired contact
// does NOT fix a ScheduledEmail that is still pending with the bad address.
// Reported, never rewritten: an operator decides whether to cancel and resend.
const pendingRows = await prisma.scheduledEmail.findMany({
  where: { status: 'pending' },
  select: { id: true, dealId: true, subject: true, toJson: true },
});
const dirtyQueue = pendingRows.filter((r) => hasInvisibleChars(JSON.stringify(r.toJson || '')));
if (dirtyQueue.length) {
  console.log(`\n⚠ ${dirtyQueue.length} PENDING queue row(s) still carry a dirty recipient.`);
  console.log('  These are frozen copies — repairing the contact does not fix them.');
  console.log('  They will keep failing until cancelled and re-sent:');
  for (const r of dirtyQueue) {
    console.log(`   · ${r.id}  deal=${r.dealId}  to=${codepoints(JSON.stringify(r.toJson))}`);
  }
}

console.log('\n─── summary ───');
console.log(`mode:      ${APPLY ? 'APPLY (wrote changes)' : 'DRY RUN (nothing written)'}`);
console.log(`scanned:   ${summary.scanned}`);
console.log(`dirty:     ${summary.dirty}`);
console.log(`repaired:  ${summary.repaired}`);
console.log(`skipped:   ${summary.skipped.length}`);
for (const s of summary.skipped) console.log(`  · ${s.table} ${s.id} — ${s.why} (${s.raw})`);
console.log(`pending queue rows still dirty: ${dirtyQueue.length}`);
if (!APPLY) console.log('\nRe-run with --apply to write these repairs.');

await prisma.$disconnect();
