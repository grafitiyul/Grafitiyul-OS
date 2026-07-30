// Live-mirror production proofs — the automatable subset.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/verify-live-proofs.mjs
//
// Read-only except proof 2, which re-delivers an ALREADY-PROCESSED event's exact
// payload to prove idempotency (the dedupe recognises it; nothing is written).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const fail = [];
const check = (ok, label, detail) => { console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) fail.push(label); };

// ── 1) crosswalk uniqueness: no duplicate entities, ever ─────────────────────
console.log('1) crosswalk uniqueness (duplicate-creation check)');
const dupSrc = await prisma.$queryRawUnsafe(`
  SELECT "sourceSystem","sourceType","sourceId", count(*)::int n
  FROM "LegacyRecord" GROUP BY 1,2,3 HAVING count(*) > 1 LIMIT 5`);
check(dupSrc.length === 0, 'no source id is crosswalked twice', JSON.stringify(dupSrc));
const dupEnt = await prisma.$queryRawUnsafe(`
  SELECT "entityType","entityId", count(*)::int n
  FROM "LegacyRecord" WHERE "entityId" IS NOT NULL AND "sourceType" IN ('deal','person','organization','tour')
  GROUP BY 1,2 HAVING count(*) > 1 LIMIT 5`);
check(dupEnt.length === 0, 'no entity is claimed by two source records', JSON.stringify(dupEnt));
const dupOrder = await prisma.$queryRawUnsafe(`
  SELECT "orderNo", count(*)::int n FROM "Deal" GROUP BY 1 HAVING count(*) > 1 LIMIT 5`);
check(dupOrder.length === 0, 'no duplicate deal orderNo', JSON.stringify(dupOrder));

// ── 2) duplicate-delivery idempotency on a representative real event ─────────
console.log('\n2) duplicate delivery of a processed event is recognised, not re-applied');
const done = await prisma.mirrorEvent.findFirst({
  where: { status: 'processed', system: 'pipedrive', entity: 'deal', outcome: { in: ['merged', 'created', 'noop'] } },
  orderBy: { receivedAt: 'desc' },
});
if (done) {
  const { receive } = await import('../../src/mirror/pipeline.js');
  const before = await prisma.mirrorEvent.count();
  const again = await receive(prisma, {
    system: done.system, entity: done.entity, externalId: done.externalId,
    changeKind: done.changeKind, transport: 'replay-proof',
    version: null, rawPayload: done.rawPayload,
  });
  const after = await prisma.mirrorEvent.count();
  check(again.duplicate === true, 'redelivery recognised as duplicate', `event ${done.id}`);
  check(after === before, 'no new event row created', `${before} → ${after}`);
} else check(false, 'no processed deal event available to test');

// ── 3) no supported event silently skipped or falsely processed ──────────────
console.log('\n3) nothing silently skipped / falsely processed');
check((await prisma.mirrorEvent.count({ where: { status: 'skipped' } })) === 0, 'zero skipped events');
const falseProcessed = await prisma.mirrorEvent.count({
  where: { status: 'processed', outcome: null },
});
check(falseProcessed === 0, 'every processed event carries an outcome', `${falseProcessed} without`);
const notCross = await prisma.mirrorEvent.count({ where: { outcome: 'not_crosswalked' } });
check(notCross === 0, 'zero events consumed as not_crosswalked (the old silent discard)', `${notCross}`);

// ── 4) pending = only the named exclusion class ──────────────────────────────
console.log('\n4) remaining pending events are named and expected');
const pending = await prisma.mirrorEvent.findMany({ where: { status: 'pending' }, select: { failureCode: true } });
const byCode = pending.reduce((m, e) => { const k = e.failureCode ?? '(fresh)'; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`   pending: ${pending.length} → ${JSON.stringify(byCode)}`);
const unexpected = Object.keys(byCode).filter((k) => !['activity_subject_not_in_gos', 'note_subject_not_in_gos', '(fresh)', 'activity_bare_person_row_excluded'].includes(k));
check(unexpected.length === 0, 'no unexpected pending class', unexpected.join(', '));

// ── 5) recent live applications (traffic since apply went on) ────────────────
console.log('\n5) live traffic applying');
const recent = await prisma.mirrorEvent.findMany({
  where: { processedAt: { gte: new Date(Date.now() - 30 * 60_000) } },
  select: { system: true, entity: true, outcome: true },
});
const rb = recent.reduce((m, e) => { const k = `${e.entity}:${e.outcome}`; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`   processed in the last 30 min: ${recent.length} → ${JSON.stringify(rb)}`);

console.log(fail.length ? `\nPROOFS FAILED: ${fail.join(' · ')}` : '\nALL AUTOMATED PROOFS PASS ✓');
await prisma.$disconnect();
process.exit(fail.length ? 2 : 0);
