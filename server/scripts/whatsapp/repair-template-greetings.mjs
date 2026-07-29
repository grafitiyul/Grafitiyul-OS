#!/usr/bin/env node
// One-off repair of a MIGRATION ARTEFACT in the imported WhatsApp templates.
//
//   node scripts/whatsapp/repair-template-greetings.mjs            (dry run)
//   node scripts/whatsapp/repair-template-greetings.mjs --apply
//
// The legacy Pipedrive/Make system marked the customer's given name with
// "[שם פרטי]" in Hebrew and, in one English body, with a bare "@". The import
// mapped the Hebrew token faithfully; the stray "@" survived as literal text, so
// the English greeting rendered as "@Hi," to the operator.
//
// This converts that artefact into the canonical variable chip, so the greeting
// resolves like every other one:  "@Hi,"  ->  "Hi {{customer_first_name}},"
//
// It also brings an English greeting into line with its Hebrew twin where the
// Hebrew personalises and the English does not:  "Hi,"  ->  "Hi {{…}},"
// The Hebrew form is "היי <chip>," — the English becomes the exact parallel, and
// NO other wording is touched.
//
// Scope is deliberately narrow on both rules — the match must be at the very
// START of the body, and the template's HEBREW body must already carry the name
// variable (proof the greeting is meant to be personalised). Nothing is invented
// for bodies that never had a name in either language. Idempotent: a body that
// already holds the chip is skipped entirely.

import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { chipHtml } from '../../../shared/variableTokens.mjs';

const KEY = 'customer_first_name';
const LABEL = 'שם פרטי של הלקוח';
const CHIP_MARKER = `data-field-key="${KEY}"`;

// "@Hi," / "@ Hi," / "@Hello," at the very start of the body.
const LEADING_AT_GREETING = /^(\s*<p>\s*)@\s*(Hi|Hello|Hey)(\s*,?)/i;
// A plain "Hi," / "Hello," / "Hey," at the very start of the body. The comma is
// REQUIRED: it is what marks the slot a name belongs in, and it keeps the rule
// from touching a sentence that merely opens with the word "Hi".
const LEADING_PLAIN_GREETING = /^(\s*<p>\s*)(Hi|Hello|Hey)\s*,/i;

const prisma = new PrismaClient(
  process.env.DATABASE_PUBLIC_URL
    ? { datasources: { db: { url: process.env.DATABASE_PUBLIC_URL } } }
    : undefined,
);

function repairEnglishGreeting(html) {
  if (!html || html.includes(CHIP_MARKER)) return null; // already personalised
  const chip = chipHtml(KEY, LABEL);
  if (LEADING_AT_GREETING.test(html)) {
    return { rule: 'stray-@', next: html.replace(LEADING_AT_GREETING, (m, open, greet) => `${open}${greet} ${chip},`) };
  }
  if (LEADING_PLAIN_GREETING.test(html)) {
    return { rule: 'plain-greeting', next: html.replace(LEADING_PLAIN_GREETING, (m, open, greet) => `${open}${greet} ${chip},`) };
  }
  return null;
}

const apply = process.argv.includes('--apply');
const templates = await prisma.whatsAppTemplate.findMany({ orderBy: { sortOrder: 'asc' } });

const fixes = [];
const leftAlone = [];
for (const t of templates) {
  const repair = repairEnglishGreeting(t.bodyEnHtml);
  if (repair && (t.bodyHeHtml || '').includes(CHIP_MARKER)) {
    fixes.push({ t, ...repair });
  } else if (/@/.test(t.bodyEnHtml || '') || /@/.test(t.bodyHeHtml || '')) {
    leftAlone.push(t);
  }
}

console.log(`=== ${apply ? 'APPLY' : 'DRY RUN'} ===`);
console.log(`templates scanned : ${templates.length}`);
console.log(`greetings to fix  : ${fixes.length}`);
for (const { t, next, rule } of fixes) {
  console.log(`\n  ${t.nameHe}   [${rule}]`);
  console.log(`    before: ${JSON.stringify((t.bodyEnHtml || '').slice(0, 80))}`);
  console.log(`    after : ${JSON.stringify(next.slice(0, 130))}`);
  // Prove ONLY the greeting moved: everything after the comma must be identical.
  const tailBefore = (t.bodyEnHtml || '').replace(/^[\s\S]*?,/, '');
  const tailAfter = next.replace(/^[\s\S]*?,/, '');
  console.log(`    wording after the greeting unchanged: ${tailBefore === tailAfter}`);
}
if (leftAlone.length) {
  console.log(`\n'@' left untouched (not a leading greeting artefact): ${leftAlone.length}`);
  for (const t of leftAlone) console.log(`  - ${t.nameHe}`);
}

// Reportable, not repaired: English bodies with no name variable at all while
// their Hebrew twin has one. Adding a name there would INVENT wording, so it
// stays an owner decision.
const asymmetric = templates.filter(
  (t) => (t.bodyHeHtml || '').includes(CHIP_MARKER)
    && t.bodyEnHtml
    && !t.bodyEnHtml.includes(CHIP_MARKER)
    && !fixes.some((f) => f.t.id === t.id),
);
if (asymmetric.length) {
  console.log(`\nFYI — Hebrew personalises the greeting, English does not (left as authored): ${asymmetric.length}`);
  for (const t of asymmetric) console.log(`  - ${t.nameHe}`);
}

if (!apply) {
  console.log('\nnothing written (dry run).');
} else {
  for (const { t, next } of fixes) {
    await prisma.whatsAppTemplate.update({ where: { id: t.id }, data: { bodyEnHtml: next } });
  }
  console.log(`\napplied ${fixes.length} repair(s).`);
}

await prisma.$disconnect();
