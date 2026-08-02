// Pre-execution safety audit data, all read-only.
import { PrismaClient } from '@prisma/client';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';

const FINAL = 'snap-20260730T081731Z-44cb';
const FREEZE = '2026-07-30';
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const layer = await loadNormalizedTourLayer(FINAL);

// ── the future tours and their legacy calendar ids ───────────────────────────
const future = layer.masterTours.filter((m) => m.date >= FREEZE && m.status !== 'מבוטל' && m.status !== 'נדחה');
const noCal = future.filter((m) => !m.legacyCalendarId);
console.log(`future master tours (not cancelled/postponed): ${future.length}`);
console.log(`  with a legacy calendar event id : ${future.length - noCal.length}`);
console.log(`  WITHOUT one                     : ${noCal.length}`);
console.log('\nthe ones with NO legacy calendar event:');
for (const m of noCal) {
  const coords = layer.coordRows.filter((c) => c.masterRecId === m.recId);
  const deals = coords.map((c) => c.legacyDealId).filter(Boolean);
  const guides = [...new Set(coords.map((c) => c.guideEmail).filter(Boolean))];
  const seats = coords.reduce((n, c) => n + (c.seats || 0), 0);
  console.log(`  ${m.recId}  ${m.date} ${m.startTime ?? '(no time)'}  status="${m.status}"  Tour_ID=${m.tourId ?? '—'}`);
  console.log(`      name="${String(m.name).slice(0, 50)}"  coordination rows=${coords.length}  seats=${seats}`);
  console.log(`      deals=${deals.join(',') || '—'}  guides=${guides.join(',') || '(none assigned)'}`);
}

// ── how the rest differ, for comparison ──────────────────────────────────────
const withCal = future.filter((m) => m.legacyCalendarId);
const stat = (list) => {
  const coordCounts = list.map((m) => layer.coordRows.filter((c) => c.masterRecId === m.recId).length);
  const guided = list.filter((m) => layer.coordRows.some((c) => c.masterRecId === m.recId && c.guideEmail));
  return { n: list.length, avgCoord: (coordCounts.reduce((a, b) => a + b, 0) / (list.length || 1)).toFixed(2), guided: guided.length };
};
console.log(`\ncomparison — with calendar id: ${JSON.stringify(stat(withCal))}`);
console.log(`             without calendar id: ${JSON.stringify(stat(noCal))}`);

// ── sweep query, exactly as the worker runs it ───────────────────────────────
const sweepNow = await prisma.tourEvent.count({ where: { gcalSyncStatus: null, status: 'scheduled', date: { gte: FREEZE } } });
const synced = await prisma.tourEvent.count({ where: { gcalSyncStatus: 'synced' } });
const pending = await prisma.tourEvent.count({ where: { gcalSyncStatus: 'pending' } });
const wave1 = await prisma.tourEvent.count({ where: { completedReason: 'migration' } });
console.log(`\nSWEEP (gcalSyncStatus IS NULL AND status='scheduled' AND date >= ${FREEZE})`);
console.log(`  matches right now, BEFORE the import : ${sweepNow}`);
console.log(`  already synced (native GOS tours)     : ${synced}`);
console.log(`  currently pending                     : ${pending}`);
console.log(`  Wave-1 historical (null, but completed+past → unreachable by the sweep): ${wave1}`);

// ── replay volume ────────────────────────────────────────────────────────────
const evTotal = await prisma.mirrorEvent.count();
const evPending = await prisma.mirrorEvent.count({ where: { status: 'pending' } });
const byEntity = await prisma.mirrorEvent.groupBy({ by: ['system', 'entity'], _count: { _all: true } });
console.log(`\nREPLAY VOLUME: ${evPending} pending of ${evTotal} total`);
for (const r of byEntity) console.log(`  ${r.system}/${r.entity}: ${r._count._all}`);

// ── GOS-native data that must not be touched ─────────────────────────────────
const nativeDeals = await prisma.deal.count({ where: { orderNo: { gte: 27000 } } });
const nativeTours = await prisma.tourEvent.count({ where: { completedReason: null, status: 'scheduled', date: { gte: FREEZE } } });
console.log(`\nGOS-NATIVE DATA`);
console.log(`  deals with orderNo >= 27000 (native numbering): ${nativeDeals}`);
console.log(`  native scheduled future tours                 : ${nativeTours}`);
await prisma.$disconnect();
