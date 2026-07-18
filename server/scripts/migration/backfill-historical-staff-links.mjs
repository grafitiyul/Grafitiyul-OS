// One-time, idempotent, previewable backfill for historical staff assignments.
//
// Phase A — canonical re-link: every unlinked TourAssignment / PayrollEntry whose
//   email-shaped externalPersonId matches an existing PersonRef email gets its
//   personRefId set. Ambiguous emails (one email → multiple PersonRefs) are
//   reported and skipped, never guessed. Reuses the SAME service the runtime
//   identity hooks use (people/historicalStaffLinks.js) — one code path.
//
// Phase B — corrupted snapshot repair: every row whose displayName is a strict
//   Airtable record id is repaired to a safe value:
//     linked → canonical personRef.displayName
//     unlinked + email externalPersonId → that email
//     else → left unresolved (UI shows the neutral fallback; nothing invented)
//
// Usage (from server/):
//   node scripts/migration/backfill-historical-staff-links.mjs            # DRY-RUN
//   node scripts/migration/backfill-historical-staff-links.mjs --apply    # MUTATE
//
// Safe: creates/deletes nothing, touches only personRefId + corrupted displayName
// snapshots, and re-running is a no-op. Does not touch Airtable.

import { PrismaClient } from '@prisma/client';
import { isEmailLike, isAirtableRecordId } from '../../../shared/staffAssignmentDisplay.mjs';
import {
  resolveHistoricalStaffLinks,
  normalizeEmail,
  planSnapshotRepairs,
  groupByValue,
} from '../../src/people/historicalStaffLinks.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

const CHUNK = 500;
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

const REC_SELECT = {
  id: true, displayName: true, externalPersonId: true, personRefId: true,
  personRef: { select: { displayName: true } },
};

async function main() {
  console.log(`\n════════ historical staff link backfill — ${APPLY ? 'APPLY (mutating)' : 'DRY-RUN (no writes)'} ════════\n`);

  // ── Phase A: canonical re-link ────────────────────────────────────────────
  const persons = await prisma.personRef.findMany({ select: { id: true, email: true, displayName: true } });
  const withEmail = persons.filter((p) => isEmailLike(normalizeEmail(p.email)));
  console.log(`PersonRefs: ${persons.length} total · ${withEmail.length} with a matchable email`);

  let linkedAsg = 0, linkedPay = 0;
  const linkedPersons = [];
  const conflictByEmail = new Map();
  for (const p of withEmail) {
    const r = await resolveHistoricalStaffLinks(prisma, p.id, { apply: APPLY });
    if (r.conflict) {
      if (!conflictByEmail.has(r.email)) conflictByEmail.set(r.email, []);
      conflictByEmail.get(r.email).push({ personRefId: p.id, name: p.displayName });
      continue;
    }
    if (r.linkedAssignments || r.linkedPayroll) {
      linkedAsg += r.linkedAssignments;
      linkedPay += r.linkedPayroll;
      linkedPersons.push({ name: p.displayName, email: r.email, asg: r.linkedAssignments, pay: r.linkedPayroll });
    }
  }

  console.log(`\n── Phase A: canonical re-link ──`);
  console.log(`  assignments ${APPLY ? 'linked' : 'eligible'}: ${linkedAsg}`);
  console.log(`  payroll rows ${APPLY ? 'linked' : 'eligible'}: ${linkedPay}`);
  console.log(`  people receiving history: ${linkedPersons.length}`);
  for (const lp of linkedPersons.sort((a, b) => b.asg - a.asg)) {
    console.log(`    ${lp.name} <${lp.email}> — ${lp.asg} assignments, ${lp.pay} payroll`);
  }
  if (conflictByEmail.size) {
    console.log(`  ⚠ ambiguous emails skipped (one email → multiple PersonRefs): ${conflictByEmail.size}`);
    for (const [email, refs] of conflictByEmail) {
      console.log(`    ${email} → ${refs.map((r) => `${r.name}(${r.personRefId})`).join(' · ')}`);
    }
  }

  // ── Phase B: corrupted snapshot repair ────────────────────────────────────
  // Runs AFTER Phase A so rows just linked resolve to their canonical name.
  const recAssignments = await prisma.tourAssignment.findMany({
    where: { displayName: { startsWith: 'rec' } }, select: REC_SELECT,
  });
  const recPayroll = await prisma.payrollEntry.findMany({
    where: { displayName: { startsWith: 'rec' } }, select: REC_SELECT,
  });
  const planA = planSnapshotRepairs(recAssignments);
  const planP = planSnapshotRepairs(recPayroll);

  const strictA = recAssignments.filter((r) => isAirtableRecordId(r.displayName)).length;
  const strictP = recPayroll.filter((r) => isAirtableRecordId(r.displayName)).length;

  console.log(`\n── Phase B: corrupted snapshot repair ──`);
  console.log(`  TourAssignment rec-id snapshots: ${strictA}`);
  console.log(`    → canonical name: ${planA.toName.length} · → email: ${planA.toEmail.length} · unresolved: ${planA.unresolved.length}`);
  console.log(`  PayrollEntry rec-id snapshots: ${strictP}`);
  console.log(`    → canonical name: ${planP.toName.length} · → email: ${planP.toEmail.length} · unresolved: ${planP.unresolved.length}`);

  let repairedName = 0, repairedEmail = 0;
  if (APPLY) {
    for (const plan of [{ model: prisma.tourAssignment, p: planA }, { model: prisma.payrollEntry, p: planP }]) {
      for (const [value, ids] of groupByValue(plan.p.toName)) {
        for (const c of chunks(ids, CHUNK)) {
          const r = await plan.model.updateMany({ where: { id: { in: c } }, data: { displayName: value } });
          repairedName += r.count;
        }
      }
      for (const [value, ids] of groupByValue(plan.p.toEmail)) {
        for (const c of chunks(ids, CHUNK)) {
          const r = await plan.model.updateMany({ where: { id: { in: c } }, data: { displayName: value } });
          repairedEmail += r.count;
        }
      }
    }
    console.log(`  applied: ${repairedName} → canonical name · ${repairedEmail} → email`);
  }

  // ── Targeted verification: Liron Marciano + the 16.7.2026 tour ─────────────
  await verify();

  console.log(`\n════════ ${APPLY ? 'APPLY COMPLETE' : 'DRY-RUN COMPLETE — re-run with --apply to mutate'} ════════\n`);
  await prisma.$disconnect();
}

async function verify() {
  console.log(`\n── verification ──`);
  const liron = await prisma.personRef.findFirst({
    where: { email: { equals: 'lyronne.marciano@gmail.com', mode: 'insensitive' } },
    select: { id: true, displayName: true, email: true },
  });
  if (!liron) { console.log('  לירון מרציאנו: PersonRef not found'); return; }
  const linked = await prisma.tourAssignment.count({ where: { personRefId: liron.id } });
  const stillUnlinked = await prisma.tourAssignment.count({
    where: { personRefId: null, externalPersonId: { equals: liron.email, mode: 'insensitive' } },
  });
  console.log(`  ${liron.displayName} <${liron.email}>: ${linked} linked assignments, ${stillUnlinked} still unlinked by email`);

  // The 16.7.2026 tour that prompted this work.
  const jul16 = await prisma.tourAssignment.findMany({
    where: { tourEvent: { date: '2026-07-16' }, externalPersonId: { equals: liron.email, mode: 'insensitive' } },
    select: { displayName: true, personRefId: true, role: true, personRef: { select: { displayName: true } } },
  });
  for (const a of jul16) {
    console.log(`  16.7.2026 → role=${a.role} · personRefId=${a.personRefId || 'null'} · snapshot="${a.displayName}" · canonical="${a.personRef?.displayName || '—'}"`);
  }
  if (!jul16.length) console.log('  16.7.2026 → no assignment found for this email (check the tour date/guide)');
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
