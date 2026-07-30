// Phase A stability gate — the six conditions that must hold before the freeze.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/verify-phase-a.mjs
//
// Read-only. Exits non-zero if ANY condition fails, so it cannot be misread as a
// pass at a glance.
import { PrismaClient } from '@prisma/client';
import { mirrorMode } from '../../src/mirror/config.js';
import { CLAIM_TTL_MS, mirrorHealth } from '../../src/mirror/worker.js';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const results = [];
const check = (ok, label, detail) => { results.push({ ok, label, detail }); console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('\n══════ PHASE A STABILITY GATE ══════\n');

// ── 1) no event destroyed ────────────────────────────────────────────────────
console.log('1) no event has been skipped or lost to a missing adapter');
const skipped = await prisma.mirrorEvent.count({ where: { status: 'skipped' } });
const noAdapter = await prisma.mirrorEvent.count({ where: { failureCode: 'no_adapter' } });
check(skipped === 0, 'zero events in status=skipped', `${skipped} found`);
check(noAdapter === 0, 'zero events carrying failureCode=no_adapter', `${noAdapter} found`);
const airtable = await prisma.mirrorEvent.count({ where: { system: 'airtable' } });
const airtableSkipped = await prisma.mirrorEvent.count({ where: { system: 'airtable', status: { not: 'pending' } } });
check(airtableSkipped === 0, `all ${airtable} Airtable events still pending`, `${airtableSkipped} not pending`);

// ── 2) every event still buffered ────────────────────────────────────────────
console.log('\n2) every captured event remains pending while apply is off');
const byStatus = await prisma.mirrorEvent.groupBy({ by: ['status'], _count: { _all: true } });
const total = await prisma.mirrorEvent.count();
const pending = await prisma.mirrorEvent.count({ where: { status: 'pending' } });
check(pending === total, `${pending}/${total} events pending`, JSON.stringify(byStatus.map((s) => `${s.status}=${s._count._all}`)));

// ── 3) the retry worker has not consumed or reclassified anything ────────────
console.log('\n3) the retry worker has not consumed, mutated or terminally classified');
const processed = await prisma.mirrorEvent.count({ where: { processedAt: { not: null } } });
const attempted = await prisma.mirrorEvent.count({ where: { attemptCount: { gt: 0 } } });
const outcomes = await prisma.mirrorEvent.count({ where: { outcome: { not: null } } });
// A claim is work-in-progress, so `claimedAt != null` at an instant is NORMAL —
// a tick was running when we looked. Two things are NOT normal:
//   * a claim the code never releases (the bug fixed in c49ac3d: the apply gate
//     buffered the event but kept the claim forever), and
//   * a claim orphaned by a container replaced mid-tick that is never reclaimed.
// Both show up the same way: a claim older than the TTL. Inside the TTL the claim
// is either live work or an orphan the worker is about to reclaim by design.
// Asserting "zero claims" would fail on healthy in-flight work and would have to
// be run at a lucky moment, which is not a gate — it is a coin toss.
const claimed = await prisma.mirrorEvent.count({ where: { claimedAt: { not: null } } });
const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
const staleClaims = await prisma.mirrorEvent.count({ where: { claimedAt: { lt: staleBefore } } });
check(processed === 0, 'no event has processedAt set', `${processed} processed`);
check(attempted === 0, 'no event has attemptCount > 0', `${attempted} attempted`);
check(outcomes === 0, 'no event has an outcome recorded', `${outcomes} with outcome`);
check(staleClaims === 0, 'no claim has outlived the claim TTL', `${staleClaims} stale of ${claimed} currently claimed (in-flight claims are normal)`);
const dead = await prisma.mirrorEvent.count({ where: { status: 'dead' } });
check(dead === 0, 'no dead-lettered events', `${dead} dead`);

// ── 4) cursors advancing ─────────────────────────────────────────────────────
console.log('\n4) poller cursors are advancing and healthy');
const cursors = await prisma.mirrorCursor.findMany({ orderBy: { id: 'asc' } });
const SEED = '2026-07-30T05:30:00.000Z';
for (const c of cursors) {
  const advanced = c.cursor && c.cursor !== SEED;
  const fresh = c.lastSuccessAt && (Date.now() - new Date(c.lastSuccessAt).getTime()) < 15 * 60 * 1000;
  console.log(`     ${c.id.padEnd(30)} cursor=${c.cursor} lastOk=${c.lastSuccessAt ? new Date(c.lastSuccessAt).toISOString() : 'never'} fails=${c.failureStreak}${advanced ? '  (advanced past seed)' : '  (still at seed — no source change yet)'}`);
  check(c.failureStreak === 0, `${c.id}: zero consecutive failures`, `streak ${c.failureStreak}${c.lastError ? ` — ${String(c.lastError).slice(0, 80)}` : ''}`);
  check(!!fresh, `${c.id}: polled successfully within the last 15 minutes`);
}
// A cursor sitting at the seed is CORRECT when nothing changed in that table —
// it is only a problem if the poller is not running, which the freshness check covers.

// ── 5) apply is off ──────────────────────────────────────────────────────────
console.log('\n5) apply remains disabled');
const mode = mirrorMode();
check(mode.capture === true, 'MIRROR_CAPTURE_ENABLED is true');
check(mode.apply === false, 'MIRROR_APPLY_ENABLED is false', `apply=${mode.apply}`);
check(mode.legacy === false, 'legacy MIRROR_ENABLED is not set', `legacy=${mode.legacy}`);
check(mode.incoherent === false, 'configuration is coherent');

// ── 6) nothing written to GOS ────────────────────────────────────────────────
console.log('\n6) the mirror has written nothing to GOS');
const wroteEntity = await prisma.mirrorEvent.count({ where: { gosEntityId: { not: null } } });
const wroteFields = await prisma.mirrorEvent.count({ where: { NOT: { fieldsWritten: { equals: null } } } });
check(wroteEntity === 0, 'no event records a GOS entity it wrote', `${wroteEntity} found`);
check(wroteFields === 0, 'no event records fields written', `${wroteFields} found`);
// A baseline is the mirror's OTHER write path: adopting one silently is how a
// change gets swallowed, so its absence matters as much as the field writes.
const baselines = await prisma.legacyRecord.count({ where: { NOT: { syncBaseline: { equals: null } } } });
check(baselines === 0, 'no sync baselines adopted yet (seeded by the cutover, not by capture)', `${baselines} found`);
const conflicts = await prisma.mirrorEvent.count({ where: { NOT: { conflicts: { equals: null } } } });
check(conflicts === 0, 'no conflicts raised', `${conflicts} found`);

// ── health summary ───────────────────────────────────────────────────────────
const health = await mirrorHealth(prisma);
console.log(`\nmirror health: ${health.ok ? 'OK' : 'PROBLEMS'} · pending ${health.pending} · dead ${health.dead} · conflicts ${health.conflicts}`);
for (const p of health.problems) console.log(`  ⚠ ${p.cursor ?? '-'}: ${p.problem} — ${p.detail}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${'═'.repeat(60)}`);
if (failed.length) {
  console.log(`PHASE A NOT SAFE — ${failed.length} condition(s) failed:`);
  for (const f of failed) console.log(`  ✗ ${f.label} — ${f.detail ?? ''}`);
  await prisma.$disconnect();
  process.exit(2);
}
console.log(`ALL ${results.length} CONDITIONS PASS — capture is buffering safely, applying nothing.`);
console.log(`events buffered: ${total} · airtable ${airtable} · pipedrive ${total - airtable}`);
await prisma.$disconnect();
