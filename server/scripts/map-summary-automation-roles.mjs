#!/usr/bin/env node
// ONE-TIME: map the tour-summary questions to their automation ROLES.
//
// This is the wiring that makes AUT-002's cards carry real content. Each role
// is written to the question's `config` — which is METADATA, not content: it
// changes nothing a responder sees, and it is copied verbatim by
// cloneStructureForNewVersion, so it survives every future version.
//
// ── Why write to the PUBLISHED version ───────────────────────────────────────
// Review cards are built from the structure a submission was filled against —
// the published one. A mapping that lived only in a draft would leave every
// card empty until someone published, which is exactly the "infrastructure done,
// workflow not working" outcome this is meant to end. Roles are not respondent-
// visible content, so writing them to the published version does not violate
// version immutability's purpose (protecting what people saw and answered).
//
// ── Roles are matched to questions BY KEY, once, here ────────────────────────
// After this runs, nothing in the codebase references these keys again: the card
// builders read `config.summaryRole` / `config.logisticsRole`. Rewording or
// reordering a question changes nothing.
//
// Usage:
//   node scripts/map-summary-automation-roles.mjs            # dry run
//   node scripts/map-summary-automation-roles.mjs --execute

import { prisma } from '../src/db.js';

const EXECUTE = process.argv.includes('--execute');

// questionKey → config patch. Verified against the live published version.
const MAPPING = {
  // ── The five narrative slots a manager reads ──
  q_6ec8bc46: { summaryRole: 'overall' },      // איך היה הסיור בכללי?
  q_812915c5: { summaryRole: 'positive' },     // משהו חיובי/ייחודי
  q_e534602d: { summaryRole: 'challenge' },    // משהו מאתגר ומה עשית
  q_27a39b83: { summaryRole: 'incidents' },    // אירועים חריגים
  q_3a70de27: { summaryRole: 'suggestions' },  // הצעות לשימור/שיפור

  // ── Logistics: only answers that need someone to ACT ──
  // yesno questions store a BOOLEAN, so no affirmativeOption is needed —
  // `true` is the signal.
  q_3dbca68c: { logisticsRole: 'studio_dirty' },       // הסטודיו היה מלוכלך/מבולגן
  q_be3b2a39: { logisticsRole: 'stencil_discarded' },  // שבלונה נזרקה
  q_11de4919: { logisticsRole: 'vinyl_low' },          // מלאי התקליטים עומד להיגמר
  // Free text: "there is text" IS the signal.
  q_9c7d49f9: { logisticsRole: 'new_spray_can' },      // הוצאת ספריי חדש
  q_75132af1: { logisticsRole: 'equipment_shortage' }, // חוסרים בציוד או בעיות טכניות
};

// Deliberately NOT mapped, and why — so the next reader does not wonder:
//   q_1aa409f5  התקבל תשלום        → AUT-001's own condition, not a card slot
//   q_05cad18d  פחיות ספריי         ┐
//   q_451a1b9e  חשמל וחיסכון        │ end-of-shift checklists. A completed
//   q_6d54be68  סדר וניקיון         │ checklist is normal work, not a problem
//   q_26ff0e9b  זבל                 │ that needs a manager to act.
//   q_641832c3  שבלונות             ┘

async function run() {
  console.log(EXECUTE ? '=== EXECUTING ===' : '=== DRY RUN ===');
  const template = await prisma.questionnaireTemplate.findFirst({
    where: { purpose: 'tour_summary', status: { not: 'archived' } },
    select: { id: true, internalName: true, currentVersionId: true },
  });
  if (!template?.currentVersionId) {
    console.error('No published tour-summary version — nothing to map.');
    process.exit(1);
  }

  const questions = await prisma.questionnaireQuestion.findMany({
    where: { versionId: template.currentVersionId },
    select: { id: true, key: true, label: true, config: true },
  });
  const byKey = new Map(questions.map((q) => [q.key, q]));

  let mapped = 0;
  let missing = 0;
  for (const [key, patch] of Object.entries(MAPPING)) {
    const q = byKey.get(key);
    if (!q) {
      console.log(`  ✕ ${key} — NOT FOUND in the published version`);
      missing++;
      continue;
    }
    const config = { ...(q.config || {}), ...patch };
    const role = patch.summaryRole || patch.logisticsRole;
    console.log(`  • ${key} → ${role}   "${(q.label?.he || '').slice(0, 45)}"`);
    if (EXECUTE) {
      await prisma.questionnaireQuestion.update({ where: { id: q.id }, data: { config } });
    }
    mapped++;
  }

  // Anything left unmapped is reported, so a new question cannot quietly sit
  // outside the automation wiring.
  const unmapped = questions.filter((q) => !MAPPING[q.key]);
  console.log(`\nUnmapped questions (${unmapped.length}) — checklists and the payment question:`);
  for (const q of unmapped) console.log(`  - ${q.key}  "${(q.label?.he || '').slice(0, 55)}"`);

  console.log(`\nmapped=${mapped} missing=${missing}`);
  if (!EXECUTE) console.log('Dry run — nothing written. Re-run with --execute.');
  await prisma.$disconnect();
}

run().catch(async (e) => {
  console.error('FAILED:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
