#!/usr/bin/env node
// ONE-TIME migration: the legacy "ניסוחים לוואטסאפ ללא מוצר" Airtable table →
// the canonical WhatsAppTemplate model.
//
//   node scripts/whatsapp/import-airtable-templates.mjs --audit
//   node scripts/whatsapp/import-airtable-templates.mjs --dry-run
//   node scripts/whatsapp/import-airtable-templates.mjs --import
//
// Airtable is a SOURCE, never a runtime dependency: nothing in the app calls it.
// Idempotent — rows upsert on (sourceSystem='airtable', sourceRecordId=recId),
// so re-running never duplicates. Read-only against Airtable (GET only).
//
// Deterministic mapping (frozen):
//   כותרת                    → nameHe            (required; no name ⇒ skipped)
//   טקסט לשליחה              → bodyHeHtml        (WhatsApp markup → editor HTML)
//   English text to send     → bodyEnHtml        (same conversion)
//   [שם פרטי]                → {{customer_first_name}} chip (the legacy token)
//   (record id)              → sourceRecordId    (provenance + idempotency key)
//   (row order in the view)  → sortOrder
//   isActive                 → true for every migrated row
// NOT migrated, deliberately: טופל and the Make-webhook buttons are Pipedrive/Make
// workflow plumbing, not template state; מזהה פייפדרייב is a dead foreign id.
// Missing languages stay empty — nothing is invented and nothing is translated.

import process from 'node:process';
import { PrismaClient } from '@prisma/client';
import { htmlToWhatsApp } from '../../../shared/waMarkup.mjs';
import { chipHtml } from '../../../shared/variableTokens.mjs';

const BASE_ID = 'appCouDLeNLtFcpFp';
const TABLE_ID = 'tblvDxFmgaYYEmsm8';
const F_NAME = 'כותרת';
const F_HE = 'טקסט לשליחה';
const F_EN = 'English text to send';

const FIRST_NAME_KEY = 'customer_first_name';
const FIRST_NAME_LABEL = 'שם פרטי של הלקוח';
// The legacy Pipedrive/Make token spellings seen in the real data.
const LEGACY_FIRST_NAME = /\[\s*(?:שם פרטי|first name|First Name)\s*\]/g;
// Non-global twin: `.test()` on a /g regex is stateful (lastIndex persists) and
// would silently miscount when reused across rows.
const HAS_LEGACY_FIRST_NAME = new RegExp(LEGACY_FIRST_NAME.source);

// Run from an operator workstation via `railway run`: DATABASE_URL points at the
// Railway-internal host, which only resolves inside the platform. Prefer the
// public URL when one is present so the same script works from either side.
const prisma = new PrismaClient(
  process.env.DATABASE_PUBLIC_URL
    ? { datasources: { db: { url: process.env.DATABASE_PUBLIC_URL } } }
    : undefined,
);

async function fetchRecords() {
  const token = String(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('AIRTABLE_PERSONAL_ACCESS_TOKEN is not set');
  const headers = { Authorization: `Bearer ${token}` };
  const out = [];
  let offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const res = await fetch(u, { headers });
    if (!res.ok) throw new Error(`Airtable HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    out.push(...(json.records || []));
    offset = json.offset || null;
  } while (offset);
  return out;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// WhatsApp markup → the editor HTML the app stores. Deliberately narrow: it
// handles exactly what htmlToWhatsApp can serialize back, so the round trip is
// verifiable (the dry run proves it per row rather than assuming it).
//   blank line → new <p>, single newline → <br>
//   *bold* _italic_ ~strike~ ```mono```  → <strong>/<em>/<s>/<code>
//   [שם פרטי] → the canonical variable chip
function markupToHtml(markup) {
  const src = String(markup ?? '').replace(/\r\n?/g, '\n').trim();
  if (!src) return null;
  // Paragraph = block separated by a blank line (htmlToWhatsApp's own policy).
  return src
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n').map((line) => {
        let out = esc(line);
        // Order matters: monospace first (it swallows other markers).
        out = out.replace(/```([^`\n]+?)```/g, (m, t) => `<code>${t}</code>`);
        out = out.replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s.,!?:;)])/g, (m, pre, t) => `${pre}<strong>${t}</strong>`);
        out = out.replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s.,!?:;)])/g, (m, pre, t) => `${pre}<em>${t}</em>`);
        out = out.replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s.,!?:;)])/g, (m, pre, t) => `${pre}<s>${t}</s>`);
        out = out.replace(LEGACY_FIRST_NAME, () => chipHtml(FIRST_NAME_KEY, FIRST_NAME_LABEL));
        return out;
      });
      return `<p>${lines.join('<br>')}</p>`;
    })
    .join('');
}

// What the source markup looks like AFTER the app's own newline policy — the
// fair comparison target for the round-trip check.
function normalizeSourceMarkup(markup) {
  return String(markup ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

// Round-trip proof: markup → HTML → markup must equal the normalized source,
// once the legacy token is accounted for.
function roundTripDiff(markup) {
  const expected = normalizeSourceMarkup(markup).replace(LEGACY_FIRST_NAME, `{{${FIRST_NAME_KEY}}}`);
  const html = markupToHtml(markup);
  const actual = htmlToWhatsApp(html || '');
  if (expected === actual) return null;
  // First differing position, with a little context on both sides.
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i += 1;
  return {
    at: i,
    expected: JSON.stringify(expected.slice(Math.max(0, i - 30), i + 40)),
    actual: JSON.stringify(actual.slice(Math.max(0, i - 30), i + 40)),
  };
}

function mapRecords(records) {
  const rows = [];
  const skipped = [];
  let order = 0;
  for (const r of records) {
    const name = String(r.fields?.[F_NAME] || '').trim();
    const he = String(r.fields?.[F_HE] || '').trim();
    const en = String(r.fields?.[F_EN] || '').trim();
    if (!name && !he && !en) {
      skipped.push({ id: r.id, reason: 'שורה ריקה לגמרי' });
      continue;
    }
    if (!he && !en) {
      // Pipedrive workflow-status stubs ("שלח" / "נשלח" / "לא נשלח - נכשל" …)
      // that live in this table but carry no wording — not templates.
      skipped.push({ id: r.id, reason: `אין תוכן בשום שפה (${name})` });
      continue;
    }
    if (!name) {
      skipped.push({ id: r.id, reason: 'יש תוכן אבל אין שם' });
      continue;
    }
    rows.push({
      sourceRecordId: r.id,
      nameHe: name,
      bodyHeHtml: markupToHtml(he),
      bodyEnHtml: markupToHtml(en),
      sortOrder: order++,
      _he: he,
      _en: en,
    });
  }
  return { rows, skipped };
}

function reportAudit(records, rows, skipped) {
  console.log('=== AIRTABLE AUDIT (read-only) ===');
  console.log(`base ${BASE_ID} / table ${TABLE_ID}`);
  console.log(`rows in table            : ${records.length}`);
  console.log(`importable templates     : ${rows.length}`);
  console.log(`skipped                  : ${skipped.length}`);
  for (const s of skipped) console.log(`   - ${s.id}: ${s.reason}`);

  const fields = new Set();
  for (const r of records) for (const k of Object.keys(r.fields || {})) fields.add(k);
  console.log(`detected columns         : ${[...fields].join(' | ')}`);

  const names = new Map();
  for (const r of rows) names.set(r.nameHe, [...(names.get(r.nameHe) || []), r.sourceRecordId]);
  const dupes = [...names].filter(([, v]) => v.length > 1);
  console.log(`duplicate names          : ${dupes.length}`);
  for (const [n, ids] of dupes) console.log(`   - "${n}": ${ids.join(', ')}`);

  const heOnly = rows.filter((r) => r.bodyHeHtml && !r.bodyEnHtml);
  const enOnly = rows.filter((r) => !r.bodyHeHtml && r.bodyEnHtml);
  console.log(`Hebrew only              : ${heOnly.length}`);
  for (const r of heOnly) console.log(`   - ${r.nameHe}`);
  console.log(`English only             : ${enOnly.length}`);
  for (const r of enOnly) console.log(`   - ${r.nameHe}`);
  console.log(`both languages           : ${rows.filter((r) => r.bodyHeHtml && r.bodyEnHtml).length}`);
  console.log(
    `rows using [שם פרטי]     : ${rows.filter((r) => HAS_LEGACY_FIRST_NAME.test(`${r._he}${r._en}`)).length}`,
  );

  console.log('\n--- formatting the editor cannot represent (round-trip check) ---');
  let bad = 0;
  for (const r of rows) {
    for (const [lang, src] of [['he', r._he], ['en', r._en]]) {
      if (!src) continue;
      const diff = roundTripDiff(src);
      if (diff) {
        bad += 1;
        console.log(`   ! ${r.sourceRecordId} "${r.nameHe}" [${lang}] @${diff.at}`);
        console.log(`       source  : ${diff.expected}`);
        console.log(`       imported: ${diff.actual}`);
      }
    }
  }
  if (!bad) console.log('   none — every body round-trips byte-for-byte through the shared serializer.');
}

async function main() {
  const mode = process.argv.includes('--import')
    ? 'import'
    : process.argv.includes('--dry-run')
      ? 'dry-run'
      : 'audit';

  const records = await fetchRecords();
  const { rows, skipped } = mapRecords(records);

  if (mode === 'audit') {
    reportAudit(records, rows, skipped);
    return;
  }

  const existing = await prisma.whatsAppTemplate.findMany({
    where: { sourceSystem: 'airtable' },
    select: { id: true, sourceRecordId: true },
  });
  const bySource = new Map(existing.map((t) => [t.sourceRecordId, t]));

  const creates = rows.filter((r) => !bySource.has(r.sourceRecordId));
  const updates = rows.filter((r) => bySource.has(r.sourceRecordId));
  console.log(`=== ${mode.toUpperCase()} ===`);
  console.log(`already imported : ${existing.length}`);
  console.log(`to create        : ${creates.length}`);
  console.log(`to update        : ${updates.length}`);
  console.log(`skipped          : ${skipped.length}`);

  if (mode === 'dry-run') {
    for (const r of creates) console.log(`   + ${r.nameHe}`);
    for (const r of updates) console.log(`   ~ ${r.nameHe}`);
    return;
  }

  for (const r of rows) {
    const data = {
      nameHe: r.nameHe,
      bodyHeHtml: r.bodyHeHtml,
      bodyEnHtml: r.bodyEnHtml,
      sortOrder: r.sortOrder,
      isActive: true,
      sourceSystem: 'airtable',
      sourceRecordId: r.sourceRecordId,
    };
    await prisma.whatsAppTemplate.upsert({
      where: { sourceSystem_sourceRecordId: { sourceSystem: 'airtable', sourceRecordId: r.sourceRecordId } },
      create: data,
      update: data,
    });
  }
  const total = await prisma.whatsAppTemplate.count();
  console.log(`done. WhatsAppTemplate rows now: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
