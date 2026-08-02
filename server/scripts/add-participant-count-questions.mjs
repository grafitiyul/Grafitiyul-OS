// One-time: add the participant-count trio to the LIVE coordination form.
//
// Written as a script rather than a migration because it edits questionnaire
// CONTENT, which the office owns — a migration would imply the schema owns it.
// Idempotent by role: a question already carrying the role is left alone, so a
// re-run after the office edits the wording changes nothing.
//
// The conditional reveal is a real `visibleWhen` on the two follow-up questions,
// evaluated by the shared condition engine — the same one every other
// questionnaire uses. Nothing about this is special-cased in the runtime.

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();
const newKey = () => `q_${crypto.randomBytes(4).toString('hex')}`;

const TEMPLATE_KEY = 'tpl_b8151c84'; // שאלון שיחת תיאום

async function main() {
  const dryRun = !process.argv.includes('--apply');

  const template = await prisma.questionnaireTemplate.findFirst({
    where: { key: TEMPLATE_KEY },
    select: { id: true, currentVersionId: true },
  });
  if (!template) throw new Error('coordination template not found');

  const versions = await prisma.questionnaireVersion.findMany({
    where: { templateId: template.id },
    select: { id: true, versionNo: true, status: true },
  });

  for (const version of versions) {
    // Only versions that can still be filled. An archived one is history.
    if (!['draft', 'published'].includes(version.status)) continue;

    const existing = await prisma.questionnaireQuestion.findMany({
      where: { versionId: version.id },
      select: { id: true, key: true, config: true, sectionId: true, sortOrder: true },
    });
    const hasRole = (role) => existing.some((q) => q?.config?.coordinationRole === role);

    if (hasRole('participant_count_matches')) {
      console.log(`v${version.versionNo}: already has the participant-count question — skipping`);
      continue;
    }

    // Append to the LAST section, after everything already there, so the office's
    // own ordering is untouched.
    const sectionId = existing[existing.length - 1]?.sectionId;
    if (!sectionId) {
      console.log(`v${version.versionNo}: no section to append to — skipping`);
      continue;
    }
    const base = Math.max(...existing.map((q) => q.sortOrder ?? 0), 0) + 1;

    const matchKey = newKey();
    const countKey = newKey();
    const noteKey = newKey();

    const rows = [
      {
        versionId: version.id, sectionId, key: matchKey, type: 'yesno',
        // Generic wording on purpose: the registered NUMBER arrives as a live
        // hint (coordinationHints.js), never baked into the question text.
        label: { he: 'האם זו הכמות הצפויה בפועל?', en: 'Is this the number actually expected?' },
        required: true, sortOrder: base,
        config: { coordinationRole: 'participant_count_matches' },
        visibleWhen: null,
      },
      {
        versionId: version.id, sectionId, key: countKey, type: 'number',
        label: { he: 'כמה משתתפים צפויים בפועל?', en: 'How many participants are actually expected?' },
        required: true, sortOrder: base + 1,
        config: { coordinationRole: 'corrected_participant_count', min: 1, max: 999 },
        // Revealed ONLY when the guide says the count does not match.
        visibleWhen: { q: matchKey, op: 'eq', value: false },
      },
      {
        versionId: version.id, sectionId, key: noteKey, type: 'textarea',
        label: { he: 'הערה', en: 'Note' },
        required: false, sortOrder: base + 2,
        config: { coordinationRole: 'participant_count_change_note' },
        visibleWhen: { q: matchKey, op: 'eq', value: false },
      },
    ];

    console.log(`v${version.versionNo} (${version.status}): adding 3 questions after sortOrder ${base - 1}`);
    for (const r of rows) console.log(`   ${r.key} ${r.type} — ${r.label.he}`);
    if (dryRun) continue;

    await prisma.$transaction(rows.map((data) => prisma.questionnaireQuestion.create({ data })));
    console.log(`v${version.versionNo}: applied`);
  }

  if (dryRun) console.log('\nDRY RUN — re-run with --apply to write.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
