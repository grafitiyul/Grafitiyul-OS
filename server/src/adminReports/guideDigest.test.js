import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGuideDigests, daysBetween } from './guideDigest.js';
import { israelLocalToMs } from '../communication/windows.js';

// Fixed "now": 2026-08-02 (a Sunday) at 08:00 Israel time.
const NOW = israelLocalToMs('2026-08-02', 8 * 60);

function fakeClient({ tours = [], coordination = [], summaries = [], home = null } = {}) {
  const calls = {};
  return {
    calls,
    tourEvent: { findMany: async (a) => { calls.tourWhere = a.where; return tours; } },
    location: { findFirst: async () => home },
    questionnaireSubmission: {
      findMany: async (a) => {
        calls[a.where.purpose] = a.where;
        return a.where.purpose === 'coordination' ? coordination : summaries;
      },
    },
  };
}

const guide = (id, name, role = 'lead_guide') => ({
  role, displayName: name, externalPersonId: id,
  personRef: { id: `pr_${id}`, displayName: name, phone: `05012345${id}`, portalToken: `tok_${id}`, portalEnabled: true },
});

const tour = (over = {}) => ({
  id: 't1', date: '2026-08-02', startTime: '10:00', status: 'scheduled', locationId: 'l1',
  product: { nameHe: 'סיור גרפיטי' },
  location: { nameHe: 'תל אביב' },
  productVariant: { locationId: 'l1', location: { nameHe: 'תל אביב' } },
  assignments: [guide('1', 'יואב כהן')],
  bookings: [{
    id: 'b1',
    deal: { participants: 4, organization: null, contacts: [{ contact: { firstNameHe: 'משפחת', lastNameHe: 'כהן' } }] },
  }],
  ...over,
});

test('each guide gets only their OWN tours', async () => {
  const c = fakeClient({
    tours: [
      tour({ id: 'tA', assignments: [guide('1', 'יואב')] }),
      tour({ id: 'tB', assignments: [guide('2', 'מיכל')] }),
    ],
  });
  const digests = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.equal(digests.length, 2);
  for (const d of digests) assert.equal(d.guideDigest.coordination.length, 1);
  assert.notEqual(digests[0].recipient.name, digests[1].recipient.name);
});

test('a guide with nothing to say gets no digest at all', async () => {
  const c = fakeClient({ tours: [] });
  assert.deepEqual(await collectGuideDigests({ nowMs: NOW, client: c }), []);
});

test('daysAway drives the icon bucket and is measured in Israel calendar days', async () => {
  const c = fakeClient({
    tours: [
      tour({ id: 'today', date: '2026-08-02' }),
      tour({ id: 'plus4', date: '2026-08-06' }),
    ],
  });
  const [d] = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.deepEqual(d.guideDigest.coordination.map((i) => i.daysAway), [0, 4]);
  assert.equal(daysBetween('2026-08-02', '2026-08-06'), 4);
});

test('a completed coordination form marks the line done', async () => {
  const c = fakeClient({ tours: [tour()], coordination: [{ subjectId: 'b1' }] });
  const [d] = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.equal(d.guideDigest.coordination[0].done, true);
});

test('one line per BOOKING — a two-booking tour yields two lines', async () => {
  const c = fakeClient({
    tours: [tour({
      bookings: [
        { id: 'b1', deal: { participants: 4, organization: null, contacts: [{ contact: { firstNameHe: 'א', lastNameHe: 'א' } }] } },
        { id: 'b2', deal: { participants: 9, organization: { name: 'חברת ABC' }, contacts: [] } },
      ],
    })],
  });
  const [d] = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.deepEqual(d.guideDigest.coordination.map((i) => i.customerName), ['א א', 'חברת ABC']);
  assert.deepEqual(d.guideDigest.coordination.map((i) => i.participants), [4, 9]);
});

test('the home location is attached so the renderer can bold only foreign cities', async () => {
  const c = fakeClient({ tours: [tour()], home: { id: 'l1' } });
  const [d] = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.equal(d.guideDigest.coordination[0].homeLocationId, 'l1');
  assert.equal(d.guideDigest.coordination[0].locationId, 'l1');
});

test('overdue summaries cover past tours only, and drop once filed', async () => {
  const past = tour({ id: 'tPast', date: '2026-07-30' });
  const c = fakeClient({ tours: [past] });
  const [d] = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.equal(d.guideDigest.coordination.length, 0, 'a past tour is not a coordination item');
  assert.deepEqual(d.guideDigest.missingSummaries.map((m) => m.tourDate), ['2026-07-30']);

  const filed = fakeClient({ tours: [past], summaries: [{ subjectId: 'tPast', actorScope: '1' }] });
  assert.deepEqual(await collectGuideDigests({ nowMs: NOW, client: filed }), []);
});

test("today's tour is never an overdue summary, even after it ended", async () => {
  // 18:00 Israel — the 10:00 tour is long over, but it is still today.
  const c = fakeClient({ tours: [tour()] });
  const [d] = await collectGuideDigests({ nowMs: israelLocalToMs('2026-08-02', 18 * 60), client: c });
  assert.deepEqual(d.guideDigest.missingSummaries, []);
});

test('the summary obligation follows REQUIRED_SUMMARY_ROLES, not the notify rule', async () => {
  // A workshop assistant owes no summary; a plain guide alongside a lead does.
  const c = fakeClient({
    tours: [tour({
      id: 'tPast', date: '2026-07-30',
      assignments: [guide('1', 'יואב', 'lead_guide'), guide('2', 'מיכל', 'guide'), guide('3', 'עוזר', 'workshop_assistant')],
    })],
  });
  const digests = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.deepEqual(digests.map((d) => d.recipient.name).sort(), ['יואב', 'מיכל']);
});

test('the recipient carries everything the dispatcher needs to reach the guide', async () => {
  const c = fakeClient({ tours: [tour()] });
  const [d] = await collectGuideDigests({ nowMs: NOW, client: c });
  assert.equal(d.recipient.personRefId, 'pr_1');
  assert.equal(d.recipient.phone, '050123451');
  assert.equal(d.recipient.name, 'יואב כהן');
  assert.equal(d.recipient.firstName, 'יואב');
});
