import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOverlap, tourStatusOf, planTourImport } from './tourImport.js';

// SYNTHETIC fixtures — this repo is public.
const TODAY = '2026-07-17';
const gos = (o) => ({ id: o.id, date: o.date, startTime: o.time ?? '10:00', kind: o.kind || 'group_slot', status: o.status || 'scheduled', bookedLegacyDealIds: new Set(o.deals || []) });

test('OVERLAP is business identity, never a timestamp', () => {
  const gosTours = [
    gos({ id: 'g1', date: '2026-08-01', time: '10:00', kind: 'group_slot' }),
    gos({ id: 'g2', date: '2026-08-01', time: '17:00', kind: 'private', deals: [1234] }),
  ];
  // (a) deal identity → duplicate even at a DIFFERENT time.
  const byDeal = classifyOverlap({ date: '2026-08-01', startTime: '18:00', isOpen: false, legacyDealIds: [1234] }, gosTours);
  assert.equal(byDeal.kind, 'duplicate_deal');
  assert.equal(byDeal.gosTourId, 'g2');
  assert.deepEqual(byDeal.sharedDeals, [1234]);
  // (b) open slot: open + same date + same start time.
  const openDup = classifyOverlap({ date: '2026-08-01', startTime: '10:00', isOpen: true, legacyDealIds: [] }, gosTours);
  assert.equal(openDup.kind, 'duplicate_open_slot');
  // (c) same date alone is COINCIDENCE — a private tour at the open slot's time…
  const priv = classifyOverlap({ date: '2026-08-01', startTime: '10:00', isOpen: false, legacyDealIds: [999] }, gosTours);
  assert.equal(priv.kind, 'coincidental_date', 'a private tour never matches an open slot by time');
  // …an open tour at a different time…
  const otherTime = classifyOverlap({ date: '2026-08-01', startTime: '12:00', isOpen: true, legacyDealIds: [] }, gosTours);
  assert.equal(otherTime.kind, 'coincidental_date');
  // …and a different date matches nothing.
  assert.equal(classifyOverlap({ date: '2026-08-02', startTime: '10:00', isOpen: true, legacyDealIds: [] }, gosTours).kind, 'none');
  // A cancelled GOS tour never claims a duplicate.
  const cancelled = classifyOverlap({ date: '2026-08-03', startTime: '10:00', isOpen: true, legacyDealIds: [] }, [gos({ id: 'g3', date: '2026-08-03', status: 'cancelled' })]);
  assert.equal(cancelled.kind, 'none');
});

test('Airtable statuses are stale — the DATE decides; cancelled/postponed survive', () => {
  assert.equal(tourStatusOf({ status: 'עתידי', date: '2023-05-01', today: TODAY }), 'completed', 'stale עתידי on a past date');
  assert.equal(tourStatusOf({ status: 'עתידי', date: '2026-09-01', today: TODAY }), 'scheduled');
  assert.equal(tourStatusOf({ status: 'הסתיים', date: '2024-01-01', today: TODAY }), 'completed');
  assert.equal(tourStatusOf({ status: 'מבוטל', date: '2026-09-01', today: TODAY }), 'cancelled');
  assert.equal(tourStatusOf({ status: 'נדחה', date: '2024-01-01', today: TODAY }), 'postponed');
});

const master = (o) => ({ recId: o.id, tourId: o.tourId ?? 1, name: o.name || 'סיור', date: o.date, startTime: o.time ?? '10:00', endTime: null, status: o.status || 'הסתיים', freeSeats: null, legacyCalendarId: o.cal || null, cardExtras: [] });
const coordOf = (o) => ({ recId: o.id, masterRecId: o.master ?? null, legacyDealId: o.deal ?? null, guideEmail: o.email || '', guideName: o.guide || '', seats: o.seats ?? null });

test('past tours import DIRECTLY as completed — the midnight worker can never sweep them', () => {
  const r = planTourImport({
    masterTours: [master({ id: 'rA', date: '2023-06-01', status: 'עתידי' })],
    coordRows: [], today: TODAY,
  });
  assert.equal(r.payloads[0].status, 'completed');
  assert.equal(r.payloads[0].completedReason, 'migration');
});

test('bookings resolve through the deal crosswalk only; registrations where seats exist (policy 5)', () => {
  const r = planTourImport({
    masterTours: [master({ id: 'rA', date: '2023-06-01' })],
    coordRows: [
      coordOf({ id: 'c1', master: 'rA', deal: 100, seats: 12, email: 'g1@x.com', guide: 'רון' }),
      coordOf({ id: 'c2', master: 'rA', deal: 200, seats: 0 }),
      coordOf({ id: 'c3', master: 'rA', deal: 999 }),                 // deal not in crosswalk
      coordOf({ id: 'c4', master: null, deal: 300 }),                  // orphan coordination
    ],
    dealXwalk: new Map([['100', 'deal-a'], ['200', 'deal-b']]),
    personRefByEmail: new Map([['g1@x.com', 'pr1']]),
    today: TODAY,
  });
  const p = r.payloads[0];
  assert.equal(p.bookings.length, 2);
  assert.equal(p.bookings[0].registration, true, 'seats>0 → historical registration');
  assert.equal(p.bookings[1].registration, false);
  assert.equal(r.stats.bookingsDealMissing, 1, 'no placeholder — counted and warned');
  assert.equal(r.stats.orphanCoordRows, 1);
  assert.equal(r.stats.registrations, 1);
  assert.equal(r.stats.seatsTotal, 12);
  assert.equal(p.guides[0].personRefId, 'pr1');
});

test('a future duplicate goes to the OWNER queue — never auto-imported, never auto-dropped', () => {
  const r = planTourImport({
    masterTours: [
      master({ id: 'rOpen', date: '2026-09-01', time: '10:00', status: 'עתידי' }),
      master({ id: 'rSafe', date: '2026-09-02', time: '10:00', status: 'עתידי' }),
    ],
    coordRows: [
      coordOf({ id: 'c1', master: 'rOpen', deal: 1 }), coordOf({ id: 'c2', master: 'rOpen', deal: 2 }), // multi-deal → open
    ],
    gosTours: [gos({ id: 'g1', date: '2026-09-01', time: '10:00', kind: 'group_slot' })],
    dealXwalk: new Map([['1', 'd1'], ['2', 'd2']]),
    today: TODAY,
  });
  assert.equal(r.stats.duplicatesForReview, 1);
  assert.equal(r.duplicates[0].kind, 'duplicate_open_slot');
  assert.equal(r.stats.create, 1, 'only the non-duplicate future tour imports');
});

test('calendar policy: adopted only when VERIFIED; otherwise the legacy id is card evidence', () => {
  const inputs = {
    masterTours: [
      master({ id: 'rF', date: '2026-09-01', status: 'עתידי', cal: 'evt_future' }),
      master({ id: 'rH', date: '2023-01-01', cal: 'evt_hist' }),
    ],
    coordRows: [], today: TODAY,
  };
  // Nothing verified → both are evidence-only.
  const none = planTourImport(inputs);
  assert.equal(none.stats.calendarAdopted, 0);
  assert.equal(none.stats.calendarEvidenceOnly, 2);
  assert.ok(none.payloads.find((p) => p.sourceRecId === 'rF').cardData.some((c) => c.value === 'evt_future'));
  // The future tour verified → adopted; the HISTORICAL one stays evidence even if listed.
  const adopted = planTourImport({ ...inputs, adoptedCalendar: new Map([['rF', { eventId: 'evt_future', accountId: 'acc1' }], ['rH', { eventId: 'evt_hist', accountId: 'acc1' }]]) });
  assert.equal(adopted.stats.calendarAdopted, 1, 'historical tours never adopt');
  assert.deepEqual(adopted.payloads.find((p) => p.sourceRecId === 'rF').calendar, { eventId: 'evt_future', accountId: 'acc1' });
  assert.equal(adopted.payloads.find((p) => p.sourceRecId === 'rH').calendar, null);
});

test('payroll imports as FROZEN evidence attached to its tour (policy 4)', () => {
  const r = planTourImport({
    masterTours: [master({ id: 'rA', date: '2023-06-01' })],
    coordRows: [],
    payrollRows: [
      { recId: 'p1', masterRecId: 'rA', guideEmail: 'g1@x.com', guideName: 'רון', role: 'מדריך ראשי', totalPreVatMinor: 45000, vatMinor: 0, approved: true, guideApproved: true, note: null },
      { recId: 'p2', masterRecId: null, guideEmail: 'g2@x.com', guideName: 'דנה', totalPreVatMinor: 30000, approved: false },
    ],
    personRefByEmail: new Map([['g1@x.com', 'pr1']]),
    today: TODAY,
  });
  assert.equal(r.stats.payrollActivities, 1);
  assert.equal(r.stats.payrollEntries, 1);
  assert.equal(r.stats.payrollUnlinked, 1, 'a payroll row without a tour link is counted, not guessed');
  const pr = r.payloads[0].payroll[0];
  assert.equal(pr.totalPreVatMinor, 45000);
  assert.equal(pr.officeApproved, true);
  assert.equal(pr.personRefId, 'pr1');
});

test('DETERMINISM: identical hashes across runs, whatever the input order', () => {
  const inputs = (order) => ({
    masterTours: order,
    coordRows: [coordOf({ id: 'c1', master: 'rA', deal: 100, seats: 3 })],
    dealXwalk: new Map([['100', 'd1']]),
    today: TODAY,
  });
  const a = planTourImport(inputs([master({ id: 'rA', date: '2023-06-01' }), master({ id: 'rB', date: '2023-06-02' })]));
  const b = planTourImport(inputs([master({ id: 'rB', date: '2023-06-02' }), master({ id: 'rA', date: '2023-06-01' })]));
  assert.equal(a.payloadHash, b.payloadHash);
});

test('idempotency: an already-imported tour is skipped', () => {
  const r = planTourImport({
    masterTours: [master({ id: 'rA', date: '2023-06-01' })],
    coordRows: [], existingTourXwalk: new Map([['rA', 'tour-live-1']]), today: TODAY,
  });
  assert.equal(r.stats.create, 0);
  assert.equal(r.stats.alreadyImported, 1);
});
