// Repair the roster damage the recompute engine caused on 2026-07-30, and
// backfill the missing crosswalk payloads that caused it.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/repair-recompute-damage.mjs [--execute]
//
// WHAT HAPPENED: cutover-imported tour crosswalks carried no `payload`, the
// child recompute read that as "no master", derived an EMPTY desired set, and
// diffSets removed the entire roster of every parent whose children changed:
// assignments deleted, bookings cancelled (12 parents, 27 members).
//
// REPAIR, from the snapshot through the SAME canonical planner:
//   1. backfill `payload` for every airtable/tour crosswalk (from the snapshot);
//   2. for each damaged parent: re-derive the desired roster with planTourImport
//      and re-create missing assignments / re-activate mirror-cancelled bookings;
//   3. the bookings check is scoped to rows CANCELLED in the replay window on
//      those parents, so a genuinely-cancelled old booking is never resurrected.
import { PrismaClient } from '@prisma/client';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';
import { planTourImport } from '../../src/migration/import/tourImport.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const layer = await loadNormalizedTourLayer('snap-20260730T081731Z-44cb');
const masterByRec = new Map(layer.masterTours.map((m) => [m.recId, m]));
const coordByMaster = new Map();
for (const c of layer.coordRows) { if (c.masterRecId) coordByMaster.set(c.masterRecId, [...(coordByMaster.get(c.masterRecId) || []), c]); }
const payrollByMaster = new Map();
for (const p of layer.payrollRows) { if (p.masterRecId) payrollByMaster.set(p.masterRecId, [...(payrollByMaster.get(p.masterRecId) || []), p]); }

// ── 1) payload backfill ─────────────────────────────────────────────────────
const links = await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'airtable', sourceType: 'tour' },
  select: { sourceId: true, entityId: true, payload: true },
});
const missing = links.filter((l) => !l.payload && masterByRec.has(l.sourceId));
console.log(`tour crosswalks: ${links.length} · without payload: ${links.filter((l) => !l.payload).length} · fillable from snapshot: ${missing.length}`);
if (EXECUTE) {
  let n = 0;
  for (const l of missing) {
    const m = masterByRec.get(l.sourceId);
    await prisma.legacyRecord.update({
      where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: l.sourceId } },
      data: { payload: { recId: m.recId, tourId: m.tourId, name: m.name, date: m.date, startTime: m.startTime, endTime: m.endTime ?? null, status: m.status } },
    });
    n += 1;
    if (n % 500 === 0) console.log(`  …${n}`);
  }
  console.log(`payloads backfilled: ${n}`);
}

// ── 2) damaged parents ──────────────────────────────────────────────────────
const recomputes = await prisma.mirrorEvent.findMany({ where: { outcome: 'recomputed' }, select: { rawPayload: true, gosEntityId: true, processedAt: true } });
const parents = new Map(); // recId → { entityId, windowStart, windowEnd }
for (const e of recomputes) {
  const link = e.rawPayload?.fields?.['שם סיור'] ?? e.rawPayload?.fields?.['סיורים'];
  const rec = Array.isArray(link) ? link[0] : null;
  if (!rec || !e.gosEntityId) continue;
  const cur = parents.get(rec) || { entityId: e.gosEntityId, times: [] };
  cur.times.push(new Date(e.processedAt));
  parents.set(rec, cur);
}
console.log(`\ndamaged parents (recomputed): ${parents.size}`);

const emails = [...new Set([...layer.payrollRows.map((p) => p.guideEmail), ...layer.coordRows.map((c) => c.guideEmail)].filter(Boolean).map((e) => String(e).toLowerCase()))];
const refs = await prisma.personRef.findMany({ where: { email: { in: emails, mode: 'insensitive' } }, select: { id: true, email: true, externalPersonId: true } });
const personRefByEmail = new Map(refs.map((r) => [String(r.email).toLowerCase(), r.id]));

let addAsg = 0; let reactivate = 0; let alreadyOk = 0;
for (const [rec, info] of parents) {
  const m = masterByRec.get(rec);
  const coords = coordByMaster.get(rec) || [];
  const dealIds = [...new Set(coords.map((c) => c.legacyDealId).filter((x) => x != null).map(String))];
  const dealLinks = dealIds.length ? await prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: { in: dealIds }, entityId: { not: null } }, select: { sourceId: true, entityId: true } }) : [];
  const dealXwalk = new Map(dealLinks.map((l) => [l.sourceId, l.entityId]));

  // Desired roster via the canonical planner (existingTourXwalk empty on purpose).
  const plan = m ? planTourImport({
    masterTours: [{ ...m }], coordRows: coords, payrollRows: payrollByMaster.get(rec) || [],
    dealXwalk, dealMetaByLegacyId: new Map(), personRefByEmail,
    existingTourXwalk: new Map(), today: new Date('2026-07-30'),
  }) : { payloads: [] };
  const payload = (plan.payloads || [])[0] || { guides: [] };

  // 2a) missing assignments
  const haveAsg = await prisma.tourAssignment.findMany({ where: { tourEventId: info.entityId }, select: { personRefId: true, externalPersonId: true } });
  const haveKeys = new Set(haveAsg.map((a) => a.personRefId || a.externalPersonId));
  for (const g of payload.guides || []) {
    const key = g.personRefId || g.email;
    if (haveKeys.has(key)) { alreadyOk += 1; continue; }
    console.log(`  + assignment ${rec}: ${g.displayName} (${g.email})${EXECUTE ? '' : '  [dry]'}`);
    if (EXECUTE) {
      await prisma.tourAssignment.create({ data: { tourEventId: info.entityId, personRefId: g.personRefId || null, externalPersonId: g.email, displayName: g.displayName, role: g.role || 'guide' } });
    }
    addAsg += 1;
  }

  // 2b) bookings cancelled by the recompute — updatedAt within ±10 min of a
  // recompute on THIS parent. Genuine old cancellations fall outside the window.
  const cancelled = await prisma.booking.findMany({ where: { tourEventId: info.entityId, status: 'cancelled' }, select: { id: true, dealId: true, seats: true, updatedAt: true } });
  for (const b of cancelled) {
    const hit = info.times.some((t) => Math.abs(new Date(b.updatedAt) - t) < 10 * 60_000);
    if (!hit) continue;
    console.log(`  ~ reactivate booking ${b.id.slice(0, 8)} on ${rec} seats=${b.seats}${EXECUTE ? '' : '  [dry]'}`);
    if (EXECUTE) await prisma.booking.update({ where: { id: b.id }, data: { status: 'active' } });
    reactivate += 1;
  }
}
console.log(`\nassignments to add: ${addAsg} · bookings to reactivate: ${reactivate} · already present: ${alreadyOk}`);
if (!EXECUTE) console.log('\n--dry: nothing written. Re-run with --execute.');
await prisma.$disconnect();
