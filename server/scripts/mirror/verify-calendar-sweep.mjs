// Post-sweep calendar verification — the owner's five proofs.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/verify-calendar-sweep.mjs [--sample N]
//
// Read-only against GOS + Google Calendar (event GETs only). Run AFTER lifting
// TOUR_CALENDAR_SYNC_ENABLED and letting the worker sweep.
import { PrismaClient } from '@prisma/client';
import { gcal } from '../../src/tours/calendar/googleCalendar.js';
import { accountHasCalendarScope } from '../../src/email/googleClient.js';

const SAMPLE = Number(process.argv[process.argv.indexOf('--sample') + 1] || 0) || 10;
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const fail = [];
const check = (ok, label, detail) => { console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) fail.push(label); };

const TODAY = new Date().toISOString().slice(0, 10);

// The imported (+ live-created) population: crosswalked scheduled future tours.
const imported = await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'airtable', sourceType: 'tour', entityId: { not: null } },
  select: { entityId: true, sourceId: true },
});
const tourIds = imported.map((r) => r.entityId);
const tours = await prisma.tourEvent.findMany({
  where: { id: { in: tourIds }, status: 'scheduled', date: { gte: TODAY } },
  select: { id: true, date: true, startTime: true, status: true, kind: true, gcalSyncStatus: true, gcalEventId: true },
});
console.log(`eligible imported scheduled future tours: ${tours.length}\n`);

// 1) one event per eligible tour
const synced = tours.filter((t) => t.gcalSyncStatus === 'synced' && t.gcalEventId);
const unsynced = tours.filter((t) => t.gcalSyncStatus !== 'synced');
check(unsynced.length === 0, `every eligible tour is synced`, `${synced.length}/${tours.length} synced${unsynced.length ? `; not synced: ${unsynced.slice(0, 5).map((t) => `${t.id.slice(0, 8)}(${t.gcalSyncStatus})`).join(', ')}` : ''}`);

// 2) no duplicate GOS events
const ids = synced.map((t) => t.gcalEventId);
check(new Set(ids).size === ids.length, 'zero duplicate gcalEventIds', `${ids.length} events, ${new Set(ids).size} distinct`);

// 3) the sweep returns zero afterwards
const sweepNow = await prisma.tourEvent.count({ where: { gcalSyncStatus: null, status: 'scheduled', date: { gte: TODAY } } });
check(sweepNow === 0, 'the sweep query matches 0 after the sweep', `${sweepNow} still null`);

// 4) failures are zero
const failed = await prisma.tourEvent.count({ where: { gcalSyncStatus: 'failed' } });
check(failed === 0, 'zero tours in gcal failed state', `${failed} failed`);

// 5) sample: dates, times, attendees against the real Google events
const accounts = await prisma.emailAccount.findMany();
const org = accounts.find((a) => accountHasCalendarScope(a));
let sampled = 0; let attendeeMatches = 0; let timeMatches = 0;
for (const t of synced.slice(0, SAMPLE)) {
  try {
    const ev = await gcal.getEvent(prisma, org, t.gcalEventId);
    sampled += 1;
    const evDate = String(ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
    const evTime = String(ev.start?.dateTime || '').slice(11, 16);
    const dateOk = evDate === String(t.date).slice(0, 10);
    const timeOk = !t.startTime || evTime === t.startTime;
    if (dateOk && timeOk) timeMatches += 1;
    const guides = await prisma.tourAssignment.findMany({ where: { tourEventId: t.id }, select: { personRefId: true, externalPersonId: true } });
    const refs = await prisma.personRef.findMany({ where: { id: { in: guides.map((g) => g.personRefId).filter(Boolean) } }, select: { email: true } });
    const guideEmails = refs.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
    const attendees = (ev.attendees || []).map((a) => String(a.email || '').toLowerCase());
    const allPresent = guideEmails.every((g) => attendees.includes(g));
    if (allPresent) attendeeMatches += 1;
    console.log(`    ${t.id.slice(0, 8)} ${t.date} ${t.startTime ?? ''} → event ${evDate} ${evTime} status=${ev.status} guides=${guideEmails.length} attendees=${attendees.length}${dateOk && timeOk ? '' : '  ⚠ MISMATCH'}${allPresent ? '' : '  ⚠ MISSING GUIDE'}`);
  } catch (e) {
    console.log(`    ${t.id.slice(0, 8)} event fetch failed: ${String(e.message).slice(0, 60)}`);
  }
}
check(sampled > 0 && timeMatches === sampled, `sampled dates/times match (${timeMatches}/${sampled})`);
check(sampled > 0 && attendeeMatches === sampled, `sampled guide attendees present (${attendeeMatches}/${sampled})`);

console.log(fail.length ? `\nSWEEP VERIFICATION FAILED: ${fail.join(' · ')}` : '\nSWEEP VERIFIED ✓');
await prisma.$disconnect();
process.exit(fail.length ? 2 : 0);
