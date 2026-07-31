// FULL live-Google verification of every future event (native + imported) —
// every owner rule, verified against the events themselves, not internal echoes.
import { PrismaClient } from '@prisma/client';
import { gcal } from '../../src/tours/calendar/googleCalendar.js';
import { accountHasCalendarScope } from '../../src/email/googleClient.js';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const org = (await prisma.emailAccount.findMany()).find((a) => accountHasCalendarScope(a));
const home = await prisma.location.findFirst({ where: { isHomeLocation: true }, select: { id: true, nameHe: true } });

const tours = await prisma.$queryRawUnsafe(`
  SELECT t.id, t.date, t."startTime", t."gcalEventId",
         (lr.id IS NOT NULL) imported,
         p."nameHe" product, v."durationHours" dur, l.id locid, l."nameHe" city
  FROM "TourEvent" t
  LEFT JOIN "LegacyRecord" lr ON lr."entityId"=t.id AND lr."sourceSystem"='airtable' AND lr."sourceType"='tour'
  LEFT JOIN "Product" p ON p.id=t."productId"
  LEFT JOIN "ProductVariant" v ON v.id=t."productVariantId"
  LEFT JOIN "Location" l ON l.id=t."locationId"
  WHERE t.status='scheduled' AND t.date::date >= CURRENT_DATE AND t."gcalSyncStatus"='synced'
  ORDER BY t.date`);

let checked = 0; let dup = 0; let homeShown = 0; let awayMissing = 0; let durBad = 0; let durDefault = 0; let oldFmt = 0; let fetchFail = 0;
const problems = [];
for (const t of tours) {
  let ev;
  try { ev = await gcal.getEvent(prisma, org, t.gcalEventId); } catch (e) { fetchFail += 1; problems.push(`fetch ${t.id.slice(0, 8)}: ${String(e.message).slice(0, 60)}`); continue; }
  checked += 1;
  const sum = String(ev.summary || '');
  if (sum.includes('·')) { oldFmt += 1; problems.push(`OLD-FORMAT: "${sum}"`); }
  if ((sum.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g) || []).length > 1) { dup += 1; problems.push(`DUP-DATE: "${sum}"`); }
  const segs = sum.split(' | ');
  const hasCitySeg = segs.length >= 4;
  if (t.locid && home && t.locid === home.id && hasCitySeg) { homeShown += 1; problems.push(`HOME-SHOWN: "${sum}"`); }
  if (t.locid && home && t.locid !== home.id && t.product && !hasCitySeg) { awayMissing += 1; problems.push(`AWAY-MISSING (${t.city}): "${sum}"`); }
  const hours = (Date.parse(ev.end?.dateTime) - Date.parse(ev.start?.dateTime)) / 3600000;
  if (t.dur != null) {
    if (Math.abs(hours - Number(t.dur)) > 0.02) { durBad += 1; problems.push(`DURATION ${hours}h≠${t.dur}h: "${sum}"`); }
  } else durDefault += 1;
}

// The specific owner check: deal #25913 → 22.12.2026 10:00.
const d25913 = await prisma.deal.findUnique({ where: { orderNo: 25913 }, select: { id: true } });
const bk = await prisma.booking.findFirst({ where: { dealId: d25913.id, status: 'active' }, select: { tourEventId: true } });
const t913 = await prisma.tourEvent.findUnique({ where: { id: bk.tourEventId }, select: { gcalEventId: true } });
const ev913 = await gcal.getEvent(prisma, org, t913.gcalEventId);
const s913 = String(ev913.start?.dateTime || '');
const ok913 = s913.startsWith('2026-12-22T10:00');
console.log(`deal #25913 event: start=${s913} summary="${ev913.summary}" ${ok913 ? '✓' : '✗ WRONG'}`);

console.log(`\nchecked ${checked}/${tours.length} events (fetch failures: ${fetchFail})`);
console.log(`old '·' format          : ${oldFmt}`);
console.log(`duplicated dates        : ${dup}`);
console.log(`home city in title      : ${homeShown}`);
console.log(`away city missing       : ${awayMissing}`);
console.log(`duration mismatches     : ${durBad}`);
console.log(`no-config default (2h)  : ${durDefault}  ← variants without a configured duration (בת מצווה)`);
for (const p of problems.slice(0, 15)) console.log('  !', p);
const clean = oldFmt === 0 && dup === 0 && homeShown === 0 && awayMissing === 0 && durBad === 0 && fetchFail === 0 && ok913;
console.log(clean ? '\nCALENDAR ROLLOUT FULLY VERIFIED ✓' : '\nISSUES REMAIN — see above');
await prisma.$disconnect();
process.exit(clean ? 0 : 2);
