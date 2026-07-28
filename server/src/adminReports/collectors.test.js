import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCoordinationWindow, collectMissingSummaries, last7DayRange, yesterdayRange,
} from './collectors.js';
import { dailyKey, slotPassed } from './daily.js';
import { COORDINATION_MONITOR_DAYS } from './coordination.js';
import { reportByNumber, renderReport } from './registry.js';
import { israelLocalToMs } from '../communication/windows.js';

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now": 2026-09-20 12:00 Israel time.
const NOW = israelLocalToMs('2026-09-20', 12 * 60);

// Minimal fake of the two Prisma models the collectors read. Captures the
// `where` clauses so the tests can assert the queries themselves.
function fakeClient({ tours = [], submissions = [] } = {}) {
  const calls = {};
  return {
    calls,
    tourEvent: {
      findMany: async (args) => { calls.tourWhere = args.where; return tours; },
    },
    questionnaireSubmission: {
      findMany: async (args) => { calls.subWhere = args.where; return submissions; },
    },
  };
}

const tour = (over = {}) => ({
  id: 't1', date: '2026-09-21', startTime: '10:00', status: 'scheduled',
  product: { nameHe: 'סיור גרפיטי' }, location: { nameHe: 'חיפה' },
  assignments: [], bookings: [],
  ...over,
});
const booking = (id, over = {}) => ({
  id, dealId: `d_${id}`,
  deal: {
    orderNo: 1, participants: 20, organization: null,
    contacts: [{ contact: { firstNameHe: 'לקוח', lastNameHe: String(id) } }],
    ...over,
  },
});
const assignment = (personId, name, role = 'guide') => ({
  externalPersonId: personId, displayName: name, role, personRef: null,
});

// ── #6 coordination monitor ──────────────────────────────────────────────────

test('#6 queries exactly the monitor window (today + N-1) and excludes cancelled tours', async () => {
  const c = fakeClient();
  await collectCoordinationWindow(NOW, c);
  assert.equal(COORDINATION_MONITOR_DAYS, 5);
  // today .. today+4 inclusive — the window is derived from the constant, so
  // changing the business rule moves the query with it.
  assert.deepEqual(c.calls.tourWhere.date, { gte: '2026-09-20', lte: '2026-09-24' });
  assert.deepEqual(c.calls.tourWhere.status, { in: ['scheduled', 'completed'] });
});

test('#6 wording states the same window the query uses', () => {
  const r = reportByNumber(6);
  assert.ok(r.nameHe.includes(`ל-${COORDINATION_MONITOR_DAYS} הימים הקרובים`));
  assert.ok(renderReport(6, { aggregate: { items: [] } }).includes(`ל-${COORDINATION_MONITOR_DAYS} הימים הקרובים`));
});

test('#6 produces ONE item per booking — a 2-booking tour yields 2 rows', async () => {
  const c = fakeClient({
    tours: [tour({ bookings: [booking('b1'), booking('b2')] })],
  });
  const items = await collectCoordinationWindow(NOW, c);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.key), ['booking:b1', 'booking:b2']);
});

test('#6 classifies overdue / open / done and sorts ⛔ → ⌛ → ✅', async () => {
  const soon = { date: '2026-09-20', startTime: '18:00' };   // deadline already passed
  const far = { date: '2026-09-22', startTime: '18:00' };    // deadline in the future
  const c = fakeClient({
    tours: [
      tour({ id: 'tOpen', ...far, bookings: [booking('bOpen')] }),
      tour({ id: 'tOverdue', ...soon, bookings: [booking('bOverdue')] }),
      tour({ id: 'tDone', ...soon, bookings: [booking('bDone')] }),
    ],
    submissions: [{ subjectId: 'bDone', submittedAt: new Date(NOW - DAY), submittedByName: 'מדריך · נועה בר' }],
  });
  const items = await collectCoordinationWindow(NOW, c);
  assert.deepEqual(items.map((i) => i.status), ['overdue', 'open', 'done']);
  // The completed one reports WHO submitted, with the portal prefix stripped.
  assert.equal(items[2].guideName, 'נועה בר');
  // Its deadline (2026-09-18 18:00) had already passed when it was submitted.
  assert.equal(items[2].wasLate, true);
});

test('#6 shows the assigned guides while the call is still pending', async () => {
  const c = fakeClient({
    tours: [tour({ assignments: [assignment('p1', 'יואב'), assignment('p2', 'מיכל')], bookings: [booking('b1')] })],
  });
  const [item] = await collectCoordinationWindow(NOW, c);
  assert.equal(item.guideName, 'יואב, מיכל');
  assert.equal(item.customerName, 'לקוח b1');
});

test('#6 only counts submitted/reviewed coordination forms — a draft is not done', async () => {
  const c = fakeClient({ tours: [tour({ bookings: [booking('b1')] })] });
  await collectCoordinationWindow(NOW, c);
  assert.equal(c.calls.subWhere.purpose, 'coordination');
  assert.equal(c.calls.subWhere.subjectType, 'booking');
  assert.deepEqual(c.calls.subWhere.status, { in: ['submitted', 'reviewed'] });
});

// ── #7 / #8 missing summaries ────────────────────────────────────────────────

const past = { date: '2026-09-19', startTime: '10:00' };

test('missing summaries are per GUIDE — two missing guides on one tour = two rows', async () => {
  const c = fakeClient({
    tours: [tour({ ...past, assignments: [assignment('p1', 'יואב', 'lead_guide'), assignment('p2', 'מיכל')], bookings: [booking('b1')] })],
  });
  const items = await collectMissingSummaries({ fromDate: '2026-09-19', toDate: '2026-09-19', nowMs: NOW, client: c });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.guideName).sort(), ['יואב', 'מיכל']);
  assert.equal(items[0].role !== undefined, true);
});

test('a guide who filed their own summary drops out; the other guide stays', async () => {
  const c = fakeClient({
    tours: [tour({ ...past, assignments: [assignment('p1', 'יואב'), assignment('p2', 'מיכל')], bookings: [booking('b1')] })],
    submissions: [{ subjectId: 't1', actorScope: 'p1' }],
  });
  const items = await collectMissingSummaries({ fromDate: '2026-09-19', toDate: '2026-09-19', nowMs: NOW, client: c });
  assert.deepEqual(items.map((i) => i.guideName), ['מיכל']);
});

test('the per-guide done-set is keyed by tour AND actor — never tour-wide', async () => {
  const c = fakeClient({ tours: [tour({ ...past, assignments: [assignment('p1', 'יואב')], bookings: [booking('b1')] })] });
  await collectMissingSummaries({ fromDate: '2026-09-19', toDate: '2026-09-19', nowMs: NOW, client: c });
  assert.equal(c.calls.subWhere.purpose, 'tour_summary');
  assert.equal(c.calls.subWhere.subjectType, 'tour_event');
  assert.deepEqual(c.calls.subWhere.status, { in: ['submitted', 'reviewed'] });
  // A submission by ANOTHER guide on the same tour must not clear this one.
  const other = fakeClient({
    tours: [tour({ ...past, assignments: [assignment('p1', 'יואב')], bookings: [booking('b1')] })],
    submissions: [{ subjectId: 't1', actorScope: 'p2' }],
  });
  const items = await collectMissingSummaries({ fromDate: '2026-09-19', toDate: '2026-09-19', nowMs: NOW, client: other });
  assert.deepEqual(items.map((i) => i.guideName), ['יואב']);
});

test('a tour that has not started yet is never reported as a missing summary', async () => {
  const c = fakeClient({
    tours: [tour({ date: '2026-09-20', startTime: '23:00', assignments: [assignment('p1', 'יואב')], bookings: [booking('b1')] })],
  });
  const items = await collectMissingSummaries({ fromDate: '2026-09-20', toDate: '2026-09-20', nowMs: NOW, client: c });
  assert.deepEqual(items, []);
});

test('missing summaries sort oldest tour first', async () => {
  const c = fakeClient({
    tours: [
      tour({ id: 'tNew', date: '2026-09-19', startTime: '10:00', assignments: [assignment('p1', 'ב')], bookings: [booking('b1')] }),
      tour({ id: 'tOld', date: '2026-09-15', startTime: '10:00', assignments: [assignment('p2', 'א')], bookings: [booking('b2')] }),
    ],
  });
  const items = await collectMissingSummaries({ fromDate: '2026-09-14', toDate: '2026-09-19', nowMs: NOW, client: c });
  assert.deepEqual(items.map((i) => i.tourEventId), ['tOld', 'tNew']);
});

// ── date ranges ──────────────────────────────────────────────────────────────

test('"7 days" is the 7 Israel days BEFORE today; "yesterday" is one day', () => {
  assert.deepEqual(last7DayRange(NOW), { fromDate: '2026-09-13', toDate: '2026-09-19' });
  assert.deepEqual(yesterdayRange(NOW), { fromDate: '2026-09-19', toDate: '2026-09-19' });
});

// ── daily scheduling ─────────────────────────────────────────────────────────

test('the daily idempotency key is one per report per Israel calendar day', () => {
  assert.equal(dailyKey(7, NOW), 'daily:7:2026-09-20');
  // Same day, 9 hours later → same key ⇒ the unique index blocks a second send.
  assert.equal(dailyKey(7, NOW + 9 * 3_600_000), 'daily:7:2026-09-20');
  assert.notEqual(dailyKey(7, NOW + DAY), dailyKey(7, NOW));
});

test('a slot fires only once its Israel-local time has passed', () => {
  const at = (h, m = 0) => israelLocalToMs('2026-09-20', h * 60 + m);
  assert.equal(slotPassed({ hour: 6, minute: 0 }, at(5, 59)), false);
  assert.equal(slotPassed({ hour: 6, minute: 0 }, at(6, 0)), true);
  assert.equal(slotPassed({ hour: 15, minute: 0 }, at(6, 0)), false);
  assert.equal(slotPassed({ hour: 15, minute: 0 }, at(15, 1)), true);
  // A late tick (server restart at 23:00) still runs the day's slot — the key
  // keeps it exactly-once rather than skipping it.
  assert.equal(slotPassed({ hour: 6, minute: 0 }, at(23, 0)), true);
});
