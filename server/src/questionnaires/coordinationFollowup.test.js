// What a submitted coordination form actually does — end to end, with the
// dispatcher captured instead of sending.
//
// The three things this has to prove, because getting any of them wrong means a
// real customer receives something wrong:
//   1. only the RIGHT booking's customer is ever addressed;
//   2. nothing operational is mutated — the card asks, it does not decide;
//   3. every action is keyed on the submission, so a replay is a no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationCustomerLabel, coordinationFollowups } from './coordinationFollowup.js';
import { GENERIC_CUSTOMER_EN, GENERIC_CUSTOMER_HE } from '../displayFallbacks.js';

const QUESTIONS = [
  { key: 'q_match', config: { coordinationRole: 'participant_count_matches' } },
  { key: 'q_count', config: { coordinationRole: 'corrected_participant_count' } },
  { key: 'q_note', config: { coordinationRole: 'participant_count_change_note' } },
  { key: 'q_mp', config: { coordinationRole: 'send_meeting_point_followup' } },
  { key: 'q_rest', config: { coordinationRole: 'send_restaurant_recommendations' } },
];

// PRODUCTION SHAPE: coordination is per-booking (not perActor), so staff links
// and their submissions carry actorScope: null — always. A test that fabricates
// an actorScope here proves a code path production can never take.
const SUBMISSION = {
  id: 'sub_1', purpose: 'coordination', subjectType: 'booking', subjectId: 'bk_A',
  actorScope: null, language: 'he',
};

/** A booking graph shaped exactly like loadCoordinationScope's select. */
function bookingRow({ id = 'bk_A', seats = [13], name = ['דנה', 'לוי'], phone = '050-1111111', lang = null } = {}) {
  return {
    id, seats: 0, notes: null, status: 'active',
    ticketRegistrations: seats.map((quantity) => ({ quantity })),
    deal: {
      id: 'deal_A', orderNo: 27184, title: 'סיור', tourLanguage: 'he', communicationLanguage: lang,
      customerInfo: null, notes: null,
      organization: { name: 'עיריית תל אביב' },
      contacts: [{
        isPrimary: true, roles: [],
        contact: { firstNameHe: name[0], lastNameHe: name[1], firstNameEn: 'Dana', lastNameEn: 'Levi', phones: phone ? [{ value: phone }] : [] },
      }],
    },
    tourEvent: {
      id: 'tour_1', date: '2026-09-16', startTime: '10:00', tourLanguage: 'he', notes: null,
      product: { nameHe: 'סיור וסדנת גרפיטי', nameEn: 'Graffiti tour' },
      productVariant: { location: { nameHe: 'פלורנטין', nameEn: 'Florentin' } },
      location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
      assignments: [{ role: 'guide', displayName: null, externalPersonId: null, personRef: { displayName: 'יואב כהן', profile: null } }],
    },
  };
}

/** Minimal fake db + a record of everything written. */
function harness({ booking = bookingRow(), meetingPoint = { html: '<p>כיכר רבין</p>', image: null } } = {}) {
  const cards = [];
  const fired = [];
  const db = {
    booking: { findUnique: async () => booking },
    personRef: { findUnique: async () => ({ displayName: 'יואב כהן', profile: null }) },
    reviewItem: {
      create: async ({ data }) => {
        if (cards.some((c) => c.dedupeKey === data.dedupeKey)) {
          const e = new Error('dup'); e.code = 'P2002'; throw e;
        }
        const row = { id: `ri_${cards.length + 1}`, ...data };
        cards.push(row);
        return row;
      },
      findUnique: async ({ where }) => cards.find((c) => c.dedupeKey === where.dedupeKey) || null,
    },
    // resolveMeetingPoint's own query.
    tourEvent: {
      findUnique: async () => ({
        id: 'tour_1', productVariantId: null,
        productVariant: null,
        location: {
          nameHe: 'תל אביב', nameEn: 'Tel Aviv',
          meetingPointHe: meetingPoint.html, meetingPointEn: null,
          meetingPointImage: meetingPoint.image,
        },
      }),
    },
  };
  const fire = async (args) => { fired.push(args); return { ok: true }; };
  return { db, fire, cards, fired, log: { error() {} } };
}

const run = (h, answers) =>
  coordinationFollowups({ submission: SUBMISSION, questions: QUESTIONS, answers }, { db: h.db, fire: h.fire, log: h.log });

// ── privacy: the canonical customer label ────────────────────────────────────

test('privacy: customer label is org → contact → generic, NEVER internal Deal.title', () => {
  const withOrg = {
    title: 'ליד חדש - לילי',
    organization: { name: 'עיריית תל אביב' },
    contacts: [{ isPrimary: true, roles: [], contact: { firstNameHe: 'לילי', lastNameHe: 'כהן' } }],
  };
  assert.equal(coordinationCustomerLabel(withOrg), 'עיריית תל אביב');
  const noOrg = { ...withOrg, organization: null };
  assert.equal(coordinationCustomerLabel(noOrg), 'לילי כהן');
  const enOnly = {
    title: 'ליד חדש - לילי',
    contacts: [{ isPrimary: true, roles: [], contact: { firstNameEn: 'Lili', lastNameEn: 'Cohen' } }],
  };
  assert.equal(coordinationCustomerLabel(enOnly), 'Lili Cohen');
  const nothing = { title: 'ליד חדש - לילי', contacts: [] };
  assert.equal(coordinationCustomerLabel(nothing), GENERIC_CUSTOMER_HE);
  assert.equal(coordinationCustomerLabel(nothing, 'en'), GENERIC_CUSTOMER_EN);
});

test('privacy: a contact-less deal fires #21/#22 with the generic label, never Deal.title', async () => {
  const booking = bookingRow();
  booking.deal.title = 'ליד חדש - לילי';
  booking.deal.organization = null;
  booking.deal.contacts = [];
  const h = harness({ booking });
  await run(h, { q_match: false, q_count: 18 });
  assert.equal(h.cards.length, 1);
  const everything = JSON.stringify({ cards: h.cards, fired: h.fired });
  assert.ok(!everything.includes('ליד חדש'), 'internal CRM title must not appear anywhere');
  assert.equal(h.fired[0].data.participantChange.customerName, GENERIC_CUSTOMER_HE);
  assert.ok(h.cards[0].title.includes(GENERIC_CUSTOMER_HE));
});

// ── participant count ────────────────────────────────────────────────────────

test('a MATCHING count creates no card and notifies nobody', async () => {
  const h = harness();
  const out = await run(h, { q_match: true });
  assert.equal(out.participantChange.changed, false);
  assert.equal(h.cards.length, 0);
  assert.equal(h.fired.length, 0);
});

test('a real change creates ONE card and fires exactly #21 and #22', async () => {
  const h = harness();
  const out = await run(h, { q_match: false, q_count: 18, q_note: 'הצטרפו שתי משפחות' });

  assert.equal(out.participantChange.changed, true);
  assert.equal(h.cards.length, 1);
  assert.equal(h.cards[0].kind, 'participant_change');
  assert.equal(h.cards[0].dedupeKey, 'participant_change:sub_1');

  assert.deepEqual(h.fired.map((f) => f.number).sort(), [21, 22]);
  for (const f of h.fired) {
    assert.equal(f.idempotencyKey, 'participant_change:sub_1', 'keyed on the immutable submission');
    const c = f.data.participantChange;
    assert.equal(c.registered, 13, 'the canonical registered count');
    assert.equal(c.corrected, 18);
    assert.equal(c.delta, 5);
    assert.equal(c.note, 'הצטרפו שתי משפחות');
    // Canonical customer label: organization first (privacy rule).
    assert.equal(c.customerName, 'עיריית תל אביב');
    // From the TOUR ASSIGNMENT — the submission's actorScope is null (above),
    // so a name here proves the canonical source is in use.
    assert.equal(c.guideNameHe, 'יואב כהן');
    assert.equal(c.guideNameEn, 'יואב כהן', 'no English profile name → the canonical resolver falls back to Hebrew');
    assert.equal(c.variantName, 'פלורנטין');
    assert.equal(c.reviewItemId, 'ri_1', 'the card exists before the message that links to it');
  }
});

test('guide name resolves from the TOUR ASSIGNMENTS (lead first, assistants never), in both languages', async () => {
  const booking = bookingRow();
  booking.tourEvent.assignments = [
    { role: 'assistant', displayName: null, externalPersonId: null, personRef: { displayName: 'עוזר הדרכה', profile: null } },
    { role: 'lead_guide', displayName: null, externalPersonId: null, personRef: { displayName: 'יואב כהן', profile: { firstNameEn: 'Yoav', lastNameEn: 'Cohen' } } },
    { role: 'guide', displayName: null, externalPersonId: null, personRef: { displayName: 'מיכל לוי', profile: null } },
  ];
  const h = harness({ booking });
  await run(h, { q_match: false, q_count: 18 });
  const c = h.fired[0].data.participantChange;
  assert.equal(c.guideNameHe, 'יואב כהן', 'the lead guide wins; the plain guide and the assistant are not shown');
  assert.equal(c.guideNameEn, 'Yoav Cohen', 'English from the canonical staff profile');
});

test('a tour with NO assigned guides freezes null — the report honestly shows —', async () => {
  const booking = bookingRow();
  booking.tourEvent.assignments = [];
  const h = harness({ booking });
  await run(h, { q_match: false, q_count: 18 });
  const c = h.fired[0].data.participantChange;
  assert.equal(c.guideNameHe, null);
  assert.equal(c.guideNameEn, null);
});

test('the registered count is the REGISTRATION sum, not Booking.seats', async () => {
  const h = harness({ booking: bookingRow({ seats: [2, 3, 8] }) });
  await run(h, { q_match: false, q_count: 20 });
  assert.equal(h.fired[0].data.participantChange.registered, 13);
});

// ── customer messages ────────────────────────────────────────────────────────

test('"כן" on the meeting point sends to THAT booking\'s customer, with the image', async () => {
  // The DB shape (r2Key/filename) — resolveMeetingPoint is what turns it into
  // the queue's attachment shape, and this test proves that translation.
  const stored = { r2Key: 'locations/meeting/x.jpg', mimeType: 'image/jpeg', filename: 'x.jpg', kind: 'image' };
  const h = harness({ meetingPoint: { html: '<p>כיכר רבין</p>', image: stored } });
  await run(h, { q_match: true, q_mp: true });

  const mp = h.fired.find((f) => f.number === 23);
  assert.ok(mp, '#23 fired');
  assert.equal(mp.idempotencyKey, 'coordination_meeting_point:sub_1');
  assert.equal(mp.recipient.phone, '050-1111111', 'this booking\'s customer');
  assert.equal(mp.data.meetingPoint.text, 'כיכר רבין', 'flattened for WhatsApp');
  assert.deepEqual(mp.data.attachments, [
    // `url` joined the resolver's image shape for the confirmation email
    // (embed-by-reference); the WhatsApp media path keeps using the key.
    { key: 'locations/meeting/x.jpg', url: null, mimeType: 'image/jpeg', fileName: 'x.jpg', kind: 'image' },
  ], 'the canonical image rides the queue media path');
});

test('meeting point with text but NO image sends a text-only message', async () => {
  const h = harness({ meetingPoint: { html: '<p>כיכר רבין</p>', image: null } });
  await run(h, { q_match: true, q_mp: true });
  const mp = h.fired.find((f) => f.number === 23);
  assert.ok(mp.data.meetingPoint.text);
  assert.deepEqual(mp.data.attachments, [], 'no attachment, and no failure either');
});

test('NO meeting-point content → no message, no failed delivery, one honest card', async () => {
  const h = harness({ meetingPoint: { html: null, image: null } });
  const out = await run(h, { q_match: true, q_mp: true });

  assert.equal(out.meetingPoint.reason, 'no_content');
  assert.ok(!h.fired.some((f) => f.number === 23), 'an empty message is never sent');
  const card = h.cards.find((c) => c.kind === 'coordination_issue');
  assert.ok(card, 'the operator can SEE that a request could not be met');
  assert.equal(card.dedupeKey, 'meeting_point_missing:sub_1');
});

test('HTML that renders to nothing is not content', async () => {
  const h = harness({ meetingPoint: { html: '<p></p><p>   </p>', image: { r2Key: 'k' } } });
  const out = await run(h, { q_match: true, q_mp: true });
  assert.equal(out.meetingPoint.reason, 'no_content', 'an image alone never qualifies');
  assert.ok(!h.fired.some((f) => f.number === 23));
});

test('"לא" and a blank answer send nothing at all', async () => {
  for (const answers of [{ q_match: true, q_mp: false, q_rest: false }, { q_match: true }]) {
    const h = harness();
    await run(h, answers);
    assert.equal(h.fired.length, 0, JSON.stringify(answers));
  }
});

test('restaurants sends the canonical link to that booking\'s customer', async () => {
  const h = harness();
  await run(h, { q_match: true, q_rest: 'כן' });
  const r = h.fired.find((f) => f.number === 24);
  assert.equal(r.idempotencyKey, 'coordination_restaurants:sub_1');
  assert.equal(r.recipient.phone, '050-1111111');
  // The link follows publicLinks.js — currently the GOS-hosted clean root URL
  // (until the WordPress shell exists; one-line change there moves everyone).
  assert.equal(r.data.publicLinks.restaurantRecommendations, 'https://app.grafitiyul.co.il/restaurant-recommendations');
});

test('a customer with no phone is a skip, never a send to nobody', async () => {
  const h = harness({ booking: bookingRow({ phone: null }) });
  const out = await run(h, { q_match: true, q_rest: true, q_mp: true });
  assert.equal(out.restaurants.reason, 'no_recipient');
  assert.equal(h.fired.length, 0);
});

test('the customer\'s own language decides what they receive', async () => {
  const h = harness({ booking: bookingRow({ lang: 'en' }) });
  await run(h, { q_match: true, q_rest: true });
  assert.equal(h.fired.find((f) => f.number === 24).recipient.preferredLanguage, 'en');
  assert.equal(h.fired.find((f) => f.number === 24).recipient.name, 'Dana Levi');
});

// ── cardinality ──────────────────────────────────────────────────────────────

test('two bookings on ONE tour reach two different customers and never cross', async () => {
  const a = harness({ booking: bookingRow({ id: 'bk_A', name: ['דנה', 'לוי'], phone: '050-1111111' }) });
  const b = harness({ booking: bookingRow({ id: 'bk_B', name: ['רון', 'ברק'], phone: '050-2222222' }) });

  // Only A's guide asked for the meeting point.
  await run(a, { q_match: true, q_mp: true });
  await run(b, { q_match: true, q_mp: false });

  assert.equal(a.fired.filter((f) => f.number === 23).length, 1);
  assert.equal(b.fired.filter((f) => f.number === 23).length, 0, 'B did not ask, B receives nothing');
  assert.equal(a.fired[0].recipient.phone, '050-1111111');
  assert.ok(!JSON.stringify(a.fired).includes('2222222'), 'A\'s send never mentions B');
});

// ── exactly once ─────────────────────────────────────────────────────────────

test('re-running the SAME submission creates no second card and no second message', async () => {
  const h = harness();
  const answers = { q_match: false, q_count: 18, q_mp: true, q_rest: true };

  await run(h, answers);
  const afterFirst = { cards: h.cards.length, fired: h.fired.length };
  assert.equal(afterFirst.cards, 1);
  assert.equal(afterFirst.fired, 4, '#21 #22 #23 #24');

  await run(h, answers);
  assert.equal(h.cards.length, 1, 'the dedupeKey held');
  // #21/#22 are gated on FIRST card creation; #23/#24 are gated by their own
  // idempotency key at the dispatcher, so they are re-offered with the SAME key.
  const keys = h.fired.map((f) => `${f.number}:${f.idempotencyKey}`);
  assert.equal(new Set(keys).size, 4, 'every replay reuses the same business key');
});

// ── the safety rule ──────────────────────────────────────────────────────────

test('NOTHING operational is mutated — the card asks, it does not decide', async () => {
  const h = harness();
  // Any write outside reviewItem.create is a violation of the safety rule.
  const forbidden = ['update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'create'];
  for (const model of ['booking', 'personRef', 'tourEvent']) {
    for (const op of forbidden) {
      h.db[model][op] = () => { throw new Error(`${model}.${op} must never be called`); };
    }
  }
  await assert.doesNotReject(run(h, { q_match: false, q_count: 18, q_mp: true, q_rest: true }));
  assert.equal(h.cards.length, 1, 'the only write is the review card');
});
