// Phase G (G2) — one-time, idempotent backfill: transfer IDENTITY ownership of
// existing staff to GOS.
//
// Until now every PersonRef had identitySource='recruitment' (name/email/phone
// mirrored from the recruitment export). Phase G makes GOS the source of truth
// for STAFF identity. This flips every current staff row (lifecycleHint='staff')
// to identitySource='management', after which:
//   • the upstream pull no longer overwrites their name/email/phone (people.js), and
//   • the GOS admin can edit those fields directly (PersonProfile EditableIdentity).
//
// SAFETY / CONTRACT:
//   • Writes GOS only: UPDATE PersonRef.identitySource, matched by id.
//   • Touches ONLY lifecycleHint='staff' rows (never trainees / former / none).
//     Trainees stay 'recruitment'-mirrored on purpose.
//   • Idempotent: re-run changes nothing (skips rows already 'management').
//   • Never creates/deletes people. No identity VALUES are changed — only the
//     ownership flag — so no data is lost.
//   • --dry-run: report only, no writes.
//
// CONFIG (env): GOS_DATABASE_URL (fallback DATABASE_URL).
// Run in prod with:  railway run node scripts/backfill-identity-source.mjs

import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry-run');
const GOS_URL = process.env.GOS_DATABASE_URL || process.env.DATABASE_URL;
if (!GOS_URL) { console.error('Missing GOS_DATABASE_URL / DATABASE_URL'); process.exit(1); }

async function main() {
  console.log(`[backfill-identity] mode=${DRY ? 'DRY-RUN (no writes)' : 'LIVE'}`);
  const prisma = new PrismaClient({ datasources: { db: { url: GOS_URL } } });

  const staff = await prisma.personRef.findMany({
    where: { lifecycleHint: 'staff' },
    select: { id: true, externalPersonId: true, displayName: true, identitySource: true },
  });

  const report = {
    dryRun: DRY,
    staffTotal: staff.length,
    alreadyManagement: 0,
    flipped: 0,
    changes: [],
  };

  for (const p of staff) {
    if (p.identitySource === 'management') { report.alreadyManagement++; continue; }
    report.changes.push({ name: p.displayName, externalPersonId: p.externalPersonId, from: p.identitySource, to: 'management' });
    if (!DRY) {
      await prisma.personRef.update({ where: { id: p.id }, data: { identitySource: 'management' } });
    }
    report.flipped++;
  }

  await prisma.$disconnect();
  console.log('\n===== IDENTITY BACKFILL REPORT =====');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error('[backfill-identity] FATAL:', e); process.exit(1); });
