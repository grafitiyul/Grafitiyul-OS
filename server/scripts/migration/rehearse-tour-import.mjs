// TOUR IMPORT REHEARSAL — read-only against production Tours.
// Normalizes the Airtable layer, runs the planner TWICE (determinism), probes
// Google Calendar adoption feasibility (READ-ONLY getEvent, --calendar flag),
// and seeds the tours review queue with GENUINE duplicates only (--seed).
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/rehearse-tour-import.mjs \
//     --snapshot <id> [--calendar] [--seed]
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { planTourImport } from '../../src/migration/import/tourImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const CHECK_CAL = process.argv.includes('--calendar');
const SEED = process.argv.includes('--seed');
if (!snapshotId) { console.error('usage: --snapshot <id> [--calendar] [--seed]'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
async function all(key) {
  const man = await reader.entityManifest(key);
  const out = [];
  for (const s of man.shards || []) { out.push(...await reader.readShard(s.key)); reader._shardCache.clear(); }
  return out;
}
const first = (v) => (Array.isArray(v) ? v[0] : v);
const t = (s) => String(s ?? '').trim();
const num = (v) => { const m = /(\d{2,})/.exec(String(first(v) ?? '')); return m ? Number(m[1]) : null; };
const hhmm = (s) => { const m = /(\d{1,2}):(\d{2})/.exec(String(first(s) || '')); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const toMinor = (v) => (v == null || v === '' ? null : Math.round(Number(first(v)) * 100));

// ── normalize the Airtable layer ──────────────────────────────────────────────
const masterRaw = await all('airtable/main/tblTI7iaGm6qsQA4a');
const coordRaw = await all('airtable/main/tbl1JaGS5oKRIkJ9z');
const payrollRaw = await all('airtable/main/tbli0eBDJ6CgCj4iJ');

const masterTours = masterRaw.map((r) => {
  const f = r.fields || {};
  return {
    recId: r.id,
    tourId: num(f.Tour_ID),
    name: t(first(f['שם']) || first(f.Name) || ''),
    date: String(first(f.DATE) || '').slice(0, 10),
    startTime: hhmm(f['שעת התחלה']) || hhmm(f['תאריך עם שעת התחלה']),
    endTime: hhmm(f['שעת סיום']),
    status: t(first(f['סטטוס']) || ''),
    freeSeats: f['מקומות פנויים'] ?? null,
    legacyCalendarId: null, // carried on coordination lookups; resolved below
    cardExtras: [
      ...(f['סיכום סיור'] ? [{ label: 'סיכום סיור (מקור)', value: t(first(f['סיכום סיור'])).slice(0, 500) }] : []),
      ...(f['משתתפים בסיור'] != null ? [{ label: 'משתתפים בסיור (מקור)', value: String(f['משתתפים בסיור']) }] : []),
    ],
  };
}).filter((m) => m.date);

const coordRows = coordRaw.map((r) => {
  const f = r.fields || {};
  return {
    recId: r.id,
    masterRecId: Array.isArray(f['שם סיור']) ? f['שם סיור'][0] : null,
    legacyDealId: num(f['פייפ דיל ID']),
    guideEmail: t(first(f['אימייל של המדריך']) || ''),
    guideName: t(first(f['מדריך ששובץ (from שם סיור)']) || ''),
    seats: f['כמות משתתפים בסיור'] != null ? Math.round(Number(first(f['כמות משתתפים בסיור']))) : null,
    legacyCalendarId: t(first(f['מזהה ארוע ביומן (from שם סיור)']) || '') || null,
  };
});
// Payroll link direction is ambiguous — the master table carries a 'שכר' linked
// field. Build payrollRec → masterRec from the MASTER side as the authoritative
// mapping (fallback when the payroll row carries no tour link of its own).
const masterByPayrollRec = new Map();
for (const r of masterRaw) {
  const link = r.fields?.['שכר'];
  if (Array.isArray(link)) for (const pr of link) masterByPayrollRec.set(pr, r.id);
}

// The calendar id lives on coordination lookups — fold onto the master row.
const calByMaster = new Map();
for (const c of coordRows) if (c.masterRecId && c.legacyCalendarId && !calByMaster.has(c.masterRecId)) calByMaster.set(c.masterRecId, c.legacyCalendarId);
for (const m of masterTours) m.legacyCalendarId = calByMaster.get(m.recId) || null;

const payrollRows = payrollRaw.map((r) => {
  const f = r.fields || {};
  const tourLink = Object.entries(f).find(([k, v]) => Array.isArray(v) && String(v[0] || '').startsWith('rec') && /סיור|tour/i.test(k));
  return {
    recId: r.id,
    masterRecId: (tourLink ? tourLink[1][0] : null) || masterByPayrollRec.get(r.id) || null,
    guideEmail: '', // payroll table keys by guide link/name, not email
    guideName: t(first(f['Guide name']) || first(f['מדריך']) || ''),
    role: t(first(f['תפקיד']) || '') || null,
    totalPreVatMinor: toMinor(f['סה"כ לתשלום לפני מע"מ']),
    vatMinor: toMinor(f['תוספת מע"מ בש"ח']),
    approved: String(first(f['מאושר']) || '') !== '',
    guideApproved: String(first(f['מאושר על ידי העובד']) || '') !== '',
    note: t(first(f['הערות משרד']) || ''),
  };
});

// ── GOS side: native tours with booked legacy deal identity + crosswalks ─────
const [gosToursRaw, xwalk, personRefs] = await Promise.all([
  prisma.tourEvent.findMany({ include: { bookings: { include: { deal: { select: { orderNo: true } } } } } }),
  prisma.legacyRecord.findMany({ where: { sourceSystem: { in: ['pipedrive', 'airtable'] }, sourceType: { in: ['deal', 'tour'] } }, select: { sourceSystem: true, sourceType: true, sourceId: true, entityId: true } }),
  prisma.personRef.findMany({ select: { id: true, email: true } }),
]);
const dealXwalk = new Map(xwalk.filter((x) => x.sourceType === 'deal').map((x) => [x.sourceId, x.entityId]));
const existingTourXwalk = new Map(xwalk.filter((x) => x.sourceType === 'tour').map((x) => [x.sourceId, x.entityId]));
const personRefByEmail = new Map(personRefs.filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p.id]));
const gosTours = gosToursRaw.map((g) => ({
  id: g.id, date: g.date, startTime: g.startTime, kind: g.kind, status: g.status,
  bookedLegacyDealIds: new Set(g.bookings.map((b) => b.deal.orderNo).filter((n) => n < 27000)),
}));
console.log(`normalized: master ${masterTours.length} · coordination ${coordRows.length} · payroll ${payrollRows.length}`);
console.log(`GOS: native tours ${gosTours.length} · deal crosswalk ${dealXwalk.size} · tour crosswalk ${existingTourXwalk.size} · guide emails ${personRefByEmail.size}`);

// ── calendar adoption feasibility (READ-ONLY Google probe) ────────────────────
const adoptedCalendar = new Map();
if (CHECK_CAL) {
  const { getSendAccount } = await import('../../src/email/simpleSend.js');
  const { gcal } = await import('../../src/tours/calendar/googleCalendar.js');
  const account = await getSendAccount().catch(() => null);
  if (!account) console.log('\ncalendar probe: NO org account available — adoption infeasible, all ids stay evidence');
  else {
    const future = masterTours.filter((m) => m.date >= today && m.legacyCalendarId && m.status !== 'מבוטל');
    let found = 0, missing = 0, cancelledEvt = 0, errors = 0;
    for (const m of future) {
      try {
        const evt = await gcal.getEvent(prisma, account, m.legacyCalendarId);
        if (evt?.status === 'cancelled') { cancelledEvt++; continue; }
        if (evt?.id) { adoptedCalendar.set(m.recId, { eventId: evt.id, accountId: account.id }); found++; }
      } catch (e) {
        if (/404|not\s*found/i.test(String(e?.message || e))) missing++;
        else { errors++; if (errors <= 3) console.log(`  probe error (${m.legacyCalendarId.slice(0, 12)}…): ${String(e?.message || e).slice(0, 80)}`); }
      }
    }
    console.log(`\ncalendar probe (org primary calendar, read-only): future tours with legacy ids ${future.length}`);
    console.log(`  VERIFIED on the org calendar (adoptable): ${found} · not found ${missing} · event cancelled ${cancelledEvt} · errors ${errors}`);
  }
}

// ── run the planner TWICE ─────────────────────────────────────────────────────
const inputs = { masterTours, coordRows, payrollRows, gosTours, dealXwalk, personRefByEmail, existingTourXwalk, adoptedCalendar, today };
const run1 = planTourImport(inputs);
const run2 = planTourImport(inputs);
console.log('\n══════ DETERMINISM ══════');
console.log(`  run 1: ${run1.payloadHash}`);
console.log(`  run 2: ${run2.payloadHash}`);
console.log(`  identical: ${run1.payloadHash === run2.payloadHash ? '✓' : '✗ FAIL'} · bytes ${run1.payloadBytes.toLocaleString()}`);

const s = run1.stats;
console.log('\n══════ TOUR REHEARSAL TOTALS ══════');
console.log(`  master tours ${s.masterTours} → create ${s.create} · duplicates for review ${s.duplicatesForReview} · already imported ${s.alreadyImported}`);
console.log(`  RECONCILES: ${s.create + s.duplicatesForReview + s.alreadyImported} = ${s.masterTours}? ${s.create + s.duplicatesForReview + s.alreadyImported === s.masterTours ? '✓' : '✗'}`);
console.log(`  by status: ${JSON.stringify(s.byStatus)} · future ${s.future} · historical ${s.historical}`);
console.log(`  bookings ${s.bookings} (deal resolved ${s.bookingsDealResolved} · deal missing ${s.bookingsDealMissing}) · orphan coordination ${s.orphanCoordRows} · tours w/o deals ${s.orphanTours}`);
console.log(`  registrations ${s.registrations} · seats ${s.seatsTotal}`);
console.log(`  assignments ${s.assignments} (PersonRef ${s.assignmentsPersonRef} · external ${s.assignmentsExternal})`);
console.log(`  calendar: adopted ${s.calendarAdopted} · evidence-only ${s.calendarEvidenceOnly}`);
console.log(`  payroll: activities ${s.payrollActivities} · entries ${s.payrollEntries} · unlinked rows ${s.payrollUnlinked}`);
console.log(`  legacy cards ${s.legacyCards} · warnings ${run1.warnings.length}`);

console.log('\n══════ GENUINE DUPLICATES (business identity) ══════');
for (const d of run1.duplicates) {
  console.log(`  ${d.kind} · Tour_ID ${d.tourId} "${(d.name || '').slice(0, 35)}" ${d.date} ${d.startTime || ''} → GOS ${d.gosTourId}${d.sharedDeals ? ' (deals ' + d.sharedDeals.join(',') + ')' : ''}`);
}
if (!run1.duplicates.length) console.log('  none');

if (SEED) {
  let created = 0, kept = 0;
  for (const d of run1.duplicates) {
    const subjectKey = `tour:${d.masterRecId}`;
    const proposal = { kind: 'tour_duplicate', ...d, source: { entity: 'airtable/main/tblTI7iaGm6qsQA4a', id: d.masterRecId } };
    const existing = await prisma.migrationDecision.findUnique({ where: { queue_subjectKey: { queue: 'tours', subjectKey } } });
    if (existing) { await prisma.migrationDecision.update({ where: { id: existing.id }, data: { proposal } }); kept++; }
    else { await prisma.migrationDecision.create({ data: { queue: 'tours', subjectKey, status: 'pending', proposal } }); created++; }
  }
  console.log(`\nseeded tours review queue: ${created} created · ${kept} refreshed`);
}
console.log(`\nread-only rehearsal complete. Production TourEvents: ${await prisma.tourEvent.count()} (untouched).`);
await prisma.$disconnect();
