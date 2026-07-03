// Slice C — one-time, idempotent backfill of GOS-owned lifecycle status.
//
// GOS now OWNS PersonRef.lifecycleHint (Slice B: the sync no longer overwrites it).
// This reconciles each existing GOS person's lifecycleHint to the CURRENT
// recruitment truth ONCE, so GOS starts owning the correct value. After this,
// lifecycle is edited only in GOS.
//
// SAFETY / CONTRACT:
//   • Reads recruitment READ-ONLY via its existing export API (no recruitment change).
//   • Writes GOS only: UPDATE PersonRef.lifecycleHint, matched by externalPersonId.
//   • Idempotent: re-run changes nothing (only sets a value; unique externalPersonId
//     → no duplicates, no inserts).
//   • Never creates/deletes people. Rows not in the current snapshot are left as-is.
//   • --dry-run: report only, no writes.
//
// CONFIG (env): GOS_DATABASE_URL (fallback DATABASE_URL), RECRUITMENT_API_BASE_URL,
//   INTERNAL_EXPORT_SECRET. Flags: --dry-run, --report <path>.

import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry-run');
const reportPath = (() => {
  const i = process.argv.indexOf('--report');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const GOS_URL = process.env.GOS_DATABASE_URL || process.env.DATABASE_URL;
const REC_BASE = process.env.RECRUITMENT_API_BASE_URL;
const SECRET = process.env.INTERNAL_EXPORT_SECRET;
if (!GOS_URL) { console.error('Missing GOS_DATABASE_URL'); process.exit(1); }
if (!REC_BASE || !SECRET) { console.error('Missing RECRUITMENT_API_BASE_URL / INTERNAL_EXPORT_SECRET'); process.exit(1); }

const norm = (v) => (v === 'trainee' || v === 'staff' ? v : null);

async function fetchSnapshot() {
  const url = `${String(REC_BASE).replace(/\/+$/, '')}/api/export/people`;
  const res = await fetch(url, { headers: { 'x-internal-export-secret': SECRET } });
  if (!res.ok) throw new Error(`recruitment export ${res.status} ${await res.text()}`);
  const body = await res.json();
  const items = Array.isArray(body) ? body : body.items || [];
  const map = new Map();
  for (const i of items) {
    const ext = String(i.externalPersonId || '').trim();
    if (ext) map.set(ext, norm(i.lifecycleHint));
  }
  return map;
}

async function main() {
  console.log(`[backfill] mode=${DRY ? 'DRY-RUN (no writes)' : 'LIVE'}`);
  const snapshot = await fetchSnapshot();
  const prisma = new PrismaClient({ datasources: { db: { url: GOS_URL } } });

  const people = await prisma.personRef.findMany({
    select: { id: true, externalPersonId: true, lifecycleHint: true, identitySource: true, displayName: true },
  });

  const report = {
    dryRun: DRY,
    gosPeople: people.length,
    snapshotPeople: snapshot.size,
    matched: 0,
    updated: 0,
    unchanged: 0,
    inGosNotInSnapshot: 0,
    missingInGos: 0,
    duplicateExternalIds: people.length - new Set(people.map((p) => p.externalPersonId)).size,
    byTargetLifecycle: { staff: 0, trainee: 0, none: 0 },
    changes: [],
    inGosNotInSnapshotDetail: [],
  };

  for (const p of people) {
    if (!snapshot.has(p.externalPersonId)) {
      report.inGosNotInSnapshot++;
      report.inGosNotInSnapshotDetail.push({ name: p.displayName, externalPersonId: p.externalPersonId, lifecycleHint: p.lifecycleHint });
      continue;
    }
    report.matched++;
    const target = snapshot.get(p.externalPersonId); // 'trainee'|'staff'|null
    report.byTargetLifecycle[target ?? 'none']++;
    const current = norm(p.lifecycleHint);
    if (current === target) { report.unchanged++; continue; }
    report.changes.push({ name: p.displayName, externalPersonId: p.externalPersonId, from: p.lifecycleHint, to: target });
    if (!DRY) {
      await prisma.personRef.update({ where: { id: p.id }, data: { lifecycleHint: target } });
    }
    report.updated++;
  }

  const gosExt = new Set(people.map((p) => p.externalPersonId));
  report.missingInGos = [...snapshot.keys()].filter((k) => !gosExt.has(k)).length;

  await prisma.$disconnect();

  console.log('\n===== BACKFILL REPORT =====');
  console.log(JSON.stringify(report, null, 2));
  if (reportPath) { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log('report written:', reportPath); }
}

main().catch((e) => { console.error('[backfill] FATAL:', e); process.exit(1); });
