#!/usr/bin/env node
// ONE-TIME: populate English drafts for existing Hebrew questionnaire content.
//
// Reuses communication/translate.js — the SAME Claude-backed translator the
// Communication Center uses, with its token-preservation check. There is no
// second translation implementation in this codebase and there must not be.
//
// Safety rules, in order of importance:
//   1. HEBREW IS NEVER TOUCHED. Only the `en` slot of a localized map is written.
//   2. EXISTING ENGLISH IS NEVER OVERWRITTEN. A field that already has English
//      is skipped, whoever wrote it.
//   3. DRAFT VERSIONS ONLY. Published versions are immutable by design; the
//      engine refuses structural writes to them and this script does not try.
//   4. Dry-run by default. --execute is required to write anything.
//
// The output is REVIEWABLE MATERIAL, not finished copy: nothing is published,
// so an admin still has to press publish after reading it.
//
// Usage:
//   node scripts/translate-questionnaires.mjs                 # dry run
//   node scripts/translate-questionnaires.mjs --execute
//   node scripts/translate-questionnaires.mjs --execute --template tour_summary

import { prisma } from '../src/db.js';
import { translateContent, translationConfigured } from '../src/communication/translate.js';
import { createNextDraft } from '../src/questionnaires/service.js';

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const templateFilter = (() => {
  const i = args.indexOf('--template');
  return i >= 0 ? args[i + 1] : null;
})();

const stats = {
  templates: 0, questions: 0, options: 0, sections: 0,
  translated: 0, skippedHasEn: 0, skippedNoHe: 0, failed: 0,
};
const failures = [];

const he = (map) => (map && typeof map === 'object' ? String(map.he || '').trim() : '');
const hasEn = (map) => !!(map && typeof map === 'object' && String(map.en || '').trim());

/** Translate ONE localized map's Hebrew into its empty English slot. */
async function translateMap(map, { label }) {
  const source = he(map);
  if (!source) { stats.skippedNoHe++; return null; }
  if (hasEn(map)) { stats.skippedHasEn++; return null; }

  try {
    // channel:'whatsapp' keeps the translator in plain-text mode — questionnaire
    // labels are not HTML documents.
    const out = await translateContent({ subject: '', body: source, channel: 'whatsapp', tone: 'operational' });
    const en = String(out?.body || '').trim();
    if (!en) { stats.failed++; failures.push(`${label}: empty translation`); return null; }
    stats.translated++;
    return { ...map, en };
  } catch (err) {
    stats.failed++;
    failures.push(`${label}: ${err?.code || err?.message || err}`);
    return null;
  }
}

async function run() {
  if (!translationConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set — cannot translate.');
    process.exit(1);
  }
  console.log(EXECUTE ? '=== EXECUTING ===' : '=== DRY RUN (no writes) ===');

  const templates = await prisma.questionnaireTemplate.findMany({
    where: {
      status: { not: 'archived' },
      ...(templateFilter ? { key: templateFilter } : {}),
    },
    select: { id: true, key: true, internalName: true, supportedLanguages: true },
  });

  for (const t of templates) {
    stats.templates++;
    console.log(`\n── ${t.internalName} (${t.key})`);

    // Only DRAFT versions are writable. A published version is frozen by
    // design; translating it would mean editing a live form's structure.
    let drafts = await prisma.questionnaireVersion.findMany({
      where: { templateId: t.id, status: 'draft' },
      include: {
        sections: { include: { questions: { include: { options: true } } } },
      },
    });

    if (!drafts.length) {
      // A questionnaire with only a published version would otherwise be
      // untranslatable without manual work. Create the next draft through the
      // CANONICAL versioning path (createNextDraft), which clones the published
      // structure — keys, options and config included — and leaves the
      // published version completely untouched.
      if (!EXECUTE) {
        console.log('   no draft version — would create one (dry run)');
        continue;
      }
      const created = await createNextDraft(t.id);
      console.log(`   + draft version ${created.existed ? '(existing)' : 'created'} for translation — published version untouched`);
      drafts = await prisma.questionnaireVersion.findMany({
        where: { id: created.id },
        include: { sections: { include: { questions: { include: { options: true } } } } },
      });
      if (!drafts.length) { console.log('   could not load the new draft — skipped'); continue; }
    }

    // English must be a supported language or the runtime will never serve it.
    if (!(t.supportedLanguages || []).includes('en') && EXECUTE) {
      await prisma.questionnaireTemplate.update({
        where: { id: t.id },
        data: { supportedLanguages: [...new Set([...(t.supportedLanguages || ['he']), 'en'])] },
      });
      console.log('   + added "en" to supported languages');
    }

    for (const v of drafts) {
      for (const section of v.sections) {
        stats.sections++;
        const title = await translateMap(section.title, { label: `section ${section.key}` });
        if (title && EXECUTE) {
          await prisma.questionnaireSection.update({ where: { id: section.id }, data: { title } });
        }
        if (title) console.log(`   § ${he(section.title)} → ${title.en}`);

        for (const q of section.questions) {
          stats.questions++;
          const label = await translateMap(q.label, { label: `question ${q.key}` });
          const helpText = await translateMap(q.helpText, { label: `help ${q.key}` });
          const placeholder = await translateMap(q.placeholder, { label: `placeholder ${q.key}` });
          const data = {};
          if (label) data.label = label;
          if (helpText) data.helpText = helpText;
          if (placeholder) data.placeholder = placeholder;
          if (Object.keys(data).length && EXECUTE) {
            await prisma.questionnaireQuestion.update({ where: { id: q.id }, data });
          }
          if (label) console.log(`   • ${he(q.label)} → ${label.en}`);

          for (const o of q.options) {
            stats.options++;
            const optLabel = await translateMap(o.label, { label: `option ${o.value}` });
            if (optLabel && EXECUTE) {
              await prisma.questionnaireQuestionOption.update({ where: { id: o.id }, data: { label: optLabel } });
            }
            if (optLabel) console.log(`     - ${he(o.label)} → ${optLabel.en}`);
          }
        }
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(stats, null, 2));
  if (failures.length) {
    console.log('\n=== NEEDS HUMAN REVIEW ===');
    for (const f of failures) console.log(' ! ' + f);
  }
  if (!EXECUTE) console.log('\nDry run — nothing was written. Re-run with --execute.');
  else console.log('\nEnglish drafts written. NOTHING WAS PUBLISHED — review, then publish the version.');

  await prisma.$disconnect();
}

run().catch(async (e) => {
  console.error('FAILED:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
