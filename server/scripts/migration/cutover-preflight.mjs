// CUTOVER PREFLIGHT — one command, complete readiness check. READ-ONLY.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/cutover-preflight.mjs \
//     [--snap1 snap-20260714T125052Z-aaaa] [--live]
//
// Verifies every dependency the cutover needs: env, R2 + snapshot, database
// state, MigrationRun + crosswalk consistency, payroll readiness, review
// queues, Google Calendar readiness, Woo state, and (with --live AND
// MIGRATION_EXTRACTION_ENABLED=true) one single GET per legacy system.
// Without both, connectivity probes are SKIPPED — post-incident rule: no
// Pipedrive/Airtable call is ever made implicitly.
//
// Exit 0 = READY. Exit 1 = NOT READY (failures listed). Fails fast per
// section but always prints the complete picture.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { migrationConfigStatus } from '../../src/migration/config.js';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';
import { accountHasCalendarScope, emailIntegrationConfigured } from '../../src/email/googleClient.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snap1Id = arg('--snap1') || 'snap-20260714T125052Z-aaaa';
const LIVE = process.argv.includes('--live');

const failures = [];
const warns = [];
const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => { failures.push(s); console.error(`  ✗ ${s}`); };
const warn = (s) => { warns.push(s); console.log(`  ⚠ ${s}`); };
const skip = (s) => console.log(`  ○ SKIP: ${s}`);
const section = (t) => console.log(`\n── ${t} ──`);

// ── 1) environment ────────────────────────────────────────────────────────────
section('environment');
const cfg = migrationConfigStatus();
if (cfg.snapshotStorage.configured) ok(`MIGRATION_R2_* complete (bucket ${cfg.snapshotStorage.bucket})`);
else bad(`MIGRATION_R2_* incomplete: ${cfg.snapshotStorage.missing.join(', ')}`);
if (process.env.MIGRATION_DB_URL || process.env.DATABASE_URL) ok('database URL present'); else bad('no MIGRATION_DB_URL / DATABASE_URL');
for (const v of ['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN', 'AIRTABLE_PERSONAL_ACCESS_TOKEN', 'AIRTABLE_MAIN_BASE_ID']) {
  if (process.env[v]) ok(`${v} present`); else bad(`${v} missing (needed for the Final Snapshot)`);
}
const calHold = process.env.TOUR_CALENDAR_SYNC_ENABLED;
if (calHold === 'false') warn('TOUR_CALENDAR_SYNC_ENABLED=false — calendar HOLD is active (correct DURING the import; lift it after verification)');
else ok('calendar sync live (normal state; set TOUR_CALENDAR_SYNC_ENABLED=false right before the cutover import)');
if (process.env.WOO_SYNC_ENABLED === 'true') {
  if (process.env.WOO_SYNC_BULK_ENABLED === 'true') warn('WOO_SYNC_BULK_ENABLED=true — the bulk sweep could mark imported tours for Woo; turn it off for cutover night');
  else ok('Woo live for native tours; imported tours stay off Woo (first-publication gate + bulk sweep off)');
} else ok('Woo sync OFF');
if (process.env.MIGRATION_EXTRACTION_ENABLED === 'true') warn('MIGRATION_EXTRACTION_ENABLED=true — leave unset except while actually extracting');
else ok('extraction gate closed (open only for the Final Snapshot run)');

// ── 2) R2 + snapshot availability + hash inputs ───────────────────────────────
section(`R2 + Snapshot #1 (${snap1Id})`);
let prisma;
try {
  const man = JSON.parse(await r2.getObjectText(`snapshots/${snap1Id}/manifest.json`));
  const entityCount = man.entities?.length ?? Object.keys(man.counts || {}).length;
  ok(`snapshot manifest readable — ${entityCount || 'n/a'} entities`);
} catch (e) { bad(`snapshot #1 manifest unreadable: ${String(e?.message || e).slice(0, 100)}`); }
try {
  const layer = await loadNormalizedTourLayer(snap1Id);
  if (layer.masterTours.length === 3508) ok(`tour normalization loads — master ${layer.masterTours.length} (=3,508)`);
  else bad(`tour layer master count ${layer.masterTours.length} ≠ 3,508 — Hash A inputs drifted`);
} catch (e) { bad(`tour normalization failed: ${String(e?.message || e).slice(0, 100)}`); }

// ── 3) database state ─────────────────────────────────────────────────────────
section('database state');
try {
  prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
  await prisma.$queryRaw`SELECT 1`;
  ok('database reachable');
} catch (e) { bad(`database unreachable: ${String(e?.message || e).slice(0, 120)}`); }

if (prisma) {
  // crosswalk consistency
  const [dealXw, tourXw, personXw, orgXw] = await Promise.all([
    prisma.legacyRecord.count({ where: { sourceSystem: 'pipedrive', sourceType: 'deal' } }),
    prisma.legacyRecord.count({ where: { sourceSystem: 'airtable', sourceType: 'tour', entityId: { not: null } } }),
    prisma.legacyRecord.count({ where: { sourceSystem: 'pipedrive', sourceType: 'person' } }),
    prisma.legacyRecord.count({ where: { sourceSystem: 'pipedrive', sourceType: 'organization' } }),
  ]);
  dealXw === 24358 ? ok(`deal crosswalk ${dealXw} (=24,358)`) : bad(`deal crosswalk ${dealXw} ≠ 24,358`);
  tourXw === 2473 ? ok(`tour crosswalk ${tourXw} (=2,473)`) : bad(`tour crosswalk ${tourXw} ≠ 2,473`);
  ok(`identity crosswalk: persons ${personXw} · orgs ${orgXw}`);
  const orphanXw = await prisma.legacyRecord.count({ where: { sourceType: { in: ['deal', 'tour'] }, entityType: 'TourEvent', entityId: null } });
  // Wave-1 integrity
  const migTours = await prisma.tourEvent.count({ where: { completedReason: 'migration' } });
  migTours === 2473 ? ok(`Wave-1 tours ${migTours} (=2,473)`) : bad(`Wave-1 tours ${migTours} ≠ 2,473`);
  const badMig = await prisma.tourEvent.count({ where: { completedReason: 'migration', OR: [{ status: { not: 'completed' } }, { gcalSyncStatus: { not: null } }] } });
  badMig === 0 ? ok('all Wave-1 tours completed + calendar-null') : bad(`${badMig} Wave-1 tours violate completed/calendar-null`);
  const dupActive = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM (SELECT "dealId" FROM "Booking" WHERE status='active' GROUP BY "dealId" HAVING COUNT(*)>1) d`;
  dupActive[0].n === 0 ? ok('one-active-booking-per-deal invariant holds') : bad(`${dupActive[0].n} deals hold >1 active booking`);

  // MigrationRun consistency
  const running = await prisma.migrationRun.findMany({ where: { status: 'running' }, select: { id: true, target: true, startedAt: true } });
  running.length === 0 ? ok('no stuck running MigrationRuns') : bad(`${running.length} MigrationRun rows stuck in 'running': ${running.map((r) => r.target).join(', ')}`);
  const w1 = await prisma.migrationRun.findFirst({ where: { target: 'import.tours.wave1', status: 'done' }, orderBy: { startedAt: 'desc' } });
  if (w1?.counters?.hashA) ok(`Wave-1 run recorded — Hash A ${String(w1.counters.hashA).slice(0, 16)}…`);
  else bad('no completed import.tours.wave1 MigrationRun with a recorded Hash A');

  // payroll readiness
  const comp = await prisma.payrollComponent.findUnique({ where: { key: 'migration_historical' } });
  comp ? ok(`frozen-evidence payroll component ${comp.id} (active:${comp.active})`) : bad('payroll component migration_historical missing');
  if (comp) {
    const foreignLines = await prisma.payrollEntryLine.count({ where: { componentId: { not: comp.id }, entry: { activity: { tourEvent: { completedReason: 'migration' } } } } });
    foreignLines === 0 ? ok('no generated payroll lines on migration tours (suppression holding)') : bad(`${foreignLines} non-frozen payroll lines appeared on migration tours — suppression breached`);
  }

  // review queues. Identity/deals/tours already imported through their own
  // approved gates — leftover pending rows are POST-import backlog, not a
  // cutover blocker. Only a pending stage_config row would corrupt the
  // cutover mapping (it feeds the deal delta + new-deal creation).
  const pending = await prisma.migrationDecision.groupBy({ by: ['queue'], where: { status: 'pending' }, _count: true });
  const stageCfg = pending.find((p) => p.queue === 'stage_config');
  stageCfg ? bad(`${stageCfg._count} pending stage_config decisions — cutover mapping unfrozen`) : ok('stage/config mapping frozen (no pending rows)');
  const backlog = pending.filter((p) => p.queue !== 'stage_config');
  if (backlog.length) warn(`review backlog (non-blocking, continues post-cutover): ${backlog.map((p) => `${p.queue}:${p._count}`).join(' · ')}`);
  else ok('review queues empty');

  // Google Calendar readiness
  section('Google Calendar');
  if (!emailIntegrationConfigured()) bad('email/Google integration not configured (GOOGLE_CLIENT_ID/SECRET) — calendar events cannot be created');
  else {
    const account = await prisma.emailAccount.findFirst({ where: { isActive: true, refreshTokenEnc: { not: null } }, orderBy: { createdAt: 'asc' } });
    if (!account) bad('no active org Google account connected');
    else if (!accountHasCalendarScope(account)) bad(`org account ${account.emailAddress} lacks calendar.events scope — reconnect via the email module`);
    else ok(`org account ${account.emailAddress} connected with calendar scope`);
    const failedCal = await prisma.tourEvent.count({ where: { gcalSyncStatus: 'failed' } });
    failedCal === 0 ? ok('no tours in gcal failed state') : warn(`${failedCal} tours with failed calendar sync (pre-existing; review before cutover)`);
  }

  // native slots (duplicate rule inputs)
  section('duplicate re-evaluation inputs');
  const nativeSlots = await prisma.tourEvent.findMany({ where: { kind: 'group_slot', status: 'scheduled' }, select: { id: true, date: true, startTime: true } });
  ok(`native scheduled group slots: ${nativeSlots.length} (business-identity duplicate targets)`);
}

// ── 4) legacy connectivity (opt-in only) ──────────────────────────────────────
section('legacy connectivity');
if (!LIVE) skip('pass --live to probe (1 GET per system)');
else if (process.env.MIGRATION_EXTRACTION_ENABLED !== 'true') bad('--live requires MIGRATION_EXTRACTION_ENABLED=true (post-incident rule: no implicit legacy calls)');
else {
  try {
    const r = await fetch(`https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1/users/me?api_token=${process.env.PIPEDRIVE_API_TOKEN}`);
    const j = await r.json();
    j?.success ? ok(`Pipedrive reachable (user ${j.data?.name || j.data?.id})`) : bad(`Pipedrive auth failed: HTTP ${r.status}`);
  } catch (e) { bad(`Pipedrive unreachable: ${String(e?.message || e).slice(0, 80)}`); }
  try {
    const r = await fetch(`https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_MAIN_BASE_ID}/tables`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN}` } });
    const j = await r.json();
    Array.isArray(j?.tables) ? ok(`Airtable reachable (${j.tables.length} tables in main base)`) : bad(`Airtable auth failed: HTTP ${r.status}`);
  } catch (e) { bad(`Airtable unreachable: ${String(e?.message || e).slice(0, 80)}`); }
}

// ── verdict ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════');
if (failures.length) {
  console.error(`NOT READY — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  if (warns.length) console.log(`(+${warns.length} warnings above)`);
  process.exitCode = 1;
} else {
  console.log(`READY ✓ (${warns.length} warnings)`);
}
if (prisma) await prisma.$disconnect();
