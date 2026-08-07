// TASK 1 — one-time production sweep: put every Contact name value into the
// language column its SCRIPT proves it belongs to.
//
// WHY: Pipedrive had first/last name fields with no language notion. After the
// migration, Latin names sit in firstNameHe/lastNameHe and Hebrew names sit in
// firstNameEn/lastNameEn on an unknown number of Contacts.
//
// THE INVARIANT
//   Hebrew columns  → Hebrew-script names only.
//   English columns → Latin names, and FOR NOW also every other non-Hebrew
//                     script (Cyrillic, Arabic, …) because GOS has no dedicated
//                     fields for those yet. Those are counted separately so the
//                     owner can decide whether such fields are needed.
//
// SAFETY
//   • DRY RUN BY DEFAULT. Pass --apply to write.
//   • Names are MOVED verbatim between columns. Never transliterated, never
//     translated, never re-split, never reordered — first stays first, last
//     stays last.
//   • A move only happens when the destination column is EMPTY. An occupied
//     destination is a CONFLICT: reported, never overwritten.
//   • Mixed-script values (Hebrew + Latin in one field) are never split.
//   • Idempotent: a second run plans 0 changes.
//   • Touches ONLY the four name columns. Never phones/emails/orgs/deals.
//
// All classification comes from server/src/maintenance/contactNameScript.js,
// which refines (never contradicts) THE canonical shared/nameLanguage.mjs.
//
// USAGE
//   export DATABASE_URL="$(railway variables --service Postgres --json | jq -r .DATABASE_PUBLIC_URL)"
//   node server/scripts/repair-contact-name-language.mjs            # census only
//   node server/scripts/repair-contact-name-language.mjs --apply    # write
//   node server/scripts/repair-contact-name-language.mjs --examples 12

import { PrismaClient } from '@prisma/client';
import {
  SCRIPTS,
  classifyFieldScript,
  planContactNames,
  verifyContactNames,
} from '../src/maintenance/contactNameScript.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const EX_FLAG = process.argv.indexOf('--examples');
const MAX_EXAMPLES = EX_FLAG > -1 ? Number(process.argv[EX_FLAG + 1]) || 6 : 6;

const FIELDS = ['firstNameHe', 'lastNameHe', 'firstNameEn', 'lastNameEn'];
const pad = (s, n) => String(s).padEnd(n);
const who = (c) => `#${c.contactNo ?? '—'} ${c.id}`;

const contacts = await prisma.contact.findMany({
  select: { id: true, contactNo: true, ...Object.fromEntries(FIELDS.map((f) => [f, true])) },
  orderBy: { createdAt: 'asc' },
});

// ── 1. PER-FIELD script census ───────────────────────────────────────────────
const perField = Object.fromEntries(
  FIELDS.map((f) => [f, Object.fromEntries(SCRIPTS.map((s) => [s, 0]))]),
);
const scriptTotals = Object.fromEntries(SCRIPTS.map((s) => [s, 0]));
const scriptExamples = Object.fromEntries(SCRIPTS.map((s) => [s, []]));

for (const c of contacts) {
  for (const f of FIELDS) {
    const script = classifyFieldScript(c[f]);
    perField[f][script] += 1;
    scriptTotals[script] += 1;
    if (script !== 'empty' && scriptExamples[script].length < MAX_EXAMPLES) {
      scriptExamples[script].push(`${who(c)}  ${f}="${c[f]}"`);
    }
  }
}

console.log('══════════════════════════════════════════════════════════════');
console.log('  TASK 1 — CONTACT NAME LANGUAGE CENSUS');
console.log('══════════════════════════════════════════════════════════════');
console.log(`mode:     ${APPLY ? 'APPLY (will write)' : 'DRY RUN (nothing written)'}`);
console.log(`Contacts: ${contacts.length}   name values: ${contacts.length * 4}`);

console.log('\n── per-field script distribution (each value classified alone) ──');
console.log(`${pad('script', 14)}${FIELDS.map((f) => pad(f, 14)).join('')}total`);
for (const s of SCRIPTS) {
  if (!scriptTotals[s]) continue;
  console.log(
    `${pad(s, 14)}${FIELDS.map((f) => pad(perField[f][s], 14)).join('')}${scriptTotals[s]}`,
  );
}

console.log('\n── THE NUMBERS YOU ASKED FOR (non-Hebrew, non-Latin values) ──');
console.log(`  Cyrillic:      ${scriptTotals.cyrillic}`);
console.log(`  Arabic:        ${scriptTotals.arabic}`);
console.log(`  Greek:         ${scriptTotals.greek}`);
console.log(`  other scripts: ${scriptTotals.other_script}`);
console.log(
  `  → total other-script name values: ${
    scriptTotals.cyrillic + scriptTotals.arabic + scriptTotals.greek + scriptTotals.other_script
  }`,
);

for (const s of ['cyrillic', 'arabic', 'greek', 'other_script', 'mixed', 'no_letters']) {
  if (!scriptExamples[s].length) continue;
  console.log(`\n  examples — ${s}:`);
  for (const e of scriptExamples[s]) console.log(`    · ${e}`);
}

// ── 2. Repair plan ───────────────────────────────────────────────────────────
const plans = contacts.map((c) => ({ contact: c, plan: planContactNames(c) }));

const buckets = {
  he_to_en: [],
  en_to_he: [],
  swap: [],
  conflict: [],
  mixed: [],
  no_letters: [],
};
for (const { contact, plan } of plans) {
  for (const slotPlan of plan.slots) {
    if (buckets[slotPlan.action]) buckets[slotPlan.action].push({ contact, slotPlan });
  }
}

const toWrite = plans.filter(({ plan }) => Object.keys(plan.patch).length);
const cleanContacts = plans.filter(
  ({ plan }) => !Object.keys(plan.patch).length && !plan.hasBlocked,
).length;

console.log('\n── repair plan (per name slot: first / last) ──');
console.log(`  safe move  he→en (non-Hebrew script out of a Hebrew column): ${buckets.he_to_en.length}`);
console.log(`  safe move  en→he (Hebrew out of an English column):          ${buckets.en_to_he.length}`);
console.log(`  safe SWAP  (each column holds the other's script, lossless): ${buckets.swap.length}`);
console.log(`  CONFLICT   (destination occupied — left untouched):          ${buckets.conflict.length}`);
console.log(`  MIXED      (Hebrew+Latin in one value — never split):        ${buckets.mixed.length}`);
console.log(`  no letters (punctuation/digits only — nothing to prove):     ${buckets.no_letters.length}`);
console.log(`\n  Contacts to update: ${toWrite.length}`);
console.log(`  Contacts already correct / untouched: ${cleanContacts}`);

// Breakdown of WHICH script drives each he→en move — this is what tells the
// owner how many moves are "real English" vs "parked foreign script".
const moveByScript = {};
for (const { slotPlan } of [...buckets.he_to_en, ...buckets.swap]) {
  const k = slotPlan.heScript;
  moveByScript[k] = (moveByScript[k] || 0) + 1;
}
console.log('\n  he→en moves by source script:');
for (const [k, v] of Object.entries(moveByScript).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${pad(k, 14)} ${v}`);
}

for (const [name, rows] of Object.entries(buckets)) {
  if (!rows.length) continue;
  console.log(`\n  examples — ${name}:`);
  for (const { contact, slotPlan } of rows.slice(0, MAX_EXAMPLES)) {
    const arrow = slotPlan.next
      ? `→ he="${slotPlan.next.he}" en="${slotPlan.next.en}"`
      : `(${slotPlan.reason})`;
    console.log(
      `    · ${who(contact)}  ${slotPlan.slot}: he="${slotPlan.he}"(${slotPlan.heScript}) ` +
        `en="${slotPlan.en}"(${slotPlan.enScript})  ${arrow}`,
    );
  }
  if (rows.length > MAX_EXAMPLES) console.log(`    … and ${rows.length - MAX_EXAMPLES} more`);
}

// ── 3. Apply ─────────────────────────────────────────────────────────────────
let written = 0;
if (APPLY && toWrite.length) {
  console.log(`\n── applying ${toWrite.length} contact update(s) ──`);
  for (const { contact, plan } of toWrite) {
    await prisma.contact.update({ where: { id: contact.id }, data: plan.patch });
    written += 1;
  }
  console.log(`  wrote ${written} contact(s).`);

  // ── 4. Prove the invariant by RE-READING from the database ────────────────
  const after = await prisma.contact.findMany({
    select: { id: true, contactNo: true, ...Object.fromEntries(FIELDS.map((f) => [f, true])) },
  });
  const stillMovable = after.flatMap((c) => {
    const v = verifyContactNames(c);
    return v.length ? [{ c, v }] : [];
  });
  const afterTotals = Object.fromEntries(SCRIPTS.map((s) => [s, 0]));
  for (const c of after) for (const f of FIELDS) afterTotals[classifyFieldScript(c[f])] += 1;

  console.log('\n── post-apply verification (re-read from DB) ──');
  console.log(`  contacts re-read: ${after.length}`);
  console.log(`  rows still holding a MOVABLE misplacement: ${stillMovable.length}  (expected 0)`);
  for (const { c, v } of stillMovable.slice(0, 10)) console.log(`    ✗ ${who(c)} — ${v.join('; ')}`);
  console.log('\n  script totals after apply:');
  for (const s of SCRIPTS) {
    if (!afterTotals[s] && !scriptTotals[s]) continue;
    const d = afterTotals[s] - scriptTotals[s];
    console.log(`    ${pad(s, 14)} ${pad(afterTotals[s], 8)} (${d >= 0 ? '+' : ''}${d})`);
  }
  // Hebrew-column purity: no Hebrew column may hold a non-Hebrew-script value
  // unless it is a reported conflict/mixed case.
  const heImpure = after.filter((c) =>
    ['firstNameHe', 'lastNameHe'].some((f) => {
      const s = classifyFieldScript(c[f]);
      return ['latin', 'cyrillic', 'arabic', 'greek', 'other_script'].includes(s);
    }),
  );
  console.log(`\n  contacts whose Hebrew columns still hold a non-Hebrew value: ${heImpure.length}`);
  console.log('    (these must ALL be conflicts — a destination was occupied)');
}

console.log('\n─── summary ───');
console.log(`mode:              ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`contacts scanned:  ${contacts.length}`);
console.log(`planned updates:   ${toWrite.length}`);
console.log(`applied updates:   ${written}`);
console.log(`ambiguous queue:   ${buckets.conflict.length} conflict + ${buckets.mixed.length} mixed (untouched)`);
if (!APPLY) console.log('\nRe-run with --apply to write these moves.');

await prisma.$disconnect();
