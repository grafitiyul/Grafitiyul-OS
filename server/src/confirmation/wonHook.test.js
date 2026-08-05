// Automatic-WON behaviour: who gets an email, who gets a review card, and
// what a replayed transition does. Fake db + injected send — no network.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';

// The hook calls sendConfirmationEmail + createReviewItem through module
// imports, so exercise the DECISION by driving its inputs through a fake db
// and asserting the observable writes.
import { runConfirmationOnWon, resolveConfirmationReview } from './wonHook.js';

function harness({ fillers = null, existingCards = [] } = {}) {
  const cards = [...existingCards];
  const scheduled = [];
  const sends = [];
  const db = {
    deal: {
      findUnique: async () => ({ id: 'd1', orderNo: 27001, organization: { name: 'עיריית תל אביב' }, contacts: [], confirmation: { fillers } }),
    },
    reviewItem: {
      create: async ({ data }) => {
        if (cards.some((c) => c.dedupeKey === data.dedupeKey)) {
          const e = new Error('dup'); e.code = 'P2002'; throw e;
        }
        const row = { id: `ri_${cards.length + 1}`, status: 'open', ...data };
        cards.push(row);
        return row;
      },
      findUnique: async ({ where }) => cards.find((c) => c.dedupeKey === where.dedupeKey) || null,
      findFirst: async ({ where }) =>
        cards.find((c) => c.status === (where.status || 'open') && c.dealId === where.dealId) || null,
      updateMany: async ({ where, data }) => {
        const row = cards.find((c) => c.id === where.id && c.status === 'open');
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    // Reached only when the hook decides to SEND (no fillers).
    confirmationEmailSend: { findMany: async () => sends, findFirst: async () => null, create: async ({ data }) => { const r = { id: `s${sends.length + 1}`, ...data }; sends.push(r); return r; } },
    scheduledEmail: { findMany: async () => [], create: async ({ data }) => { const r = { id: `q${scheduled.length + 1}`, ...data }; scheduled.push(r); return r; } },
    $transaction: async (fn) => fn(db),
  };
  return { db, cards, scheduled, sends, log: { warn() {}, error() {} } };
}

const KEY = 'won_transition:d1:1767225600000';

test('fillers + SYSTEM-driven WON → review card, never a blind send', async () => {
  const h = harness({ fillers: [{ kind: 'other_note', noteHe: 'תנאי' }] });
  const out = await runConfirmationOnWon(
    { dealId: 'd1', transitionKey: KEY, closedByUserId: null },
    { db: h.db, log: h.log },
  );
  assert.equal(out.pendingReview, true);
  assert.equal(h.cards.length, 1);
  assert.equal(h.scheduled.length, 0, 'no email may be queued');
  assert.match(h.cards[0].summary, /נסגרה אוטומטית/);
  assert.equal(h.cards[0].dealId, 'd1');
});

test('fillers + OPERATOR-driven WON → card too (the UI opens the preview)', async () => {
  const h = harness({ fillers: [{ kind: 'new_guide', mode: 'default' }] });
  const out = await runConfirmationOnWon(
    { dealId: 'd1', transitionKey: KEY, closedByUserId: 'user_1' },
    { db: h.db, log: h.log },
  );
  assert.equal(out.pendingReview, true);
  assert.equal(h.scheduled.length, 0);
  assert.doesNotMatch(h.cards[0].summary, /נסגרה אוטומטית/);
});

test('a REPLAYED transition (duplicate webhook) creates at most one card', async () => {
  const h = harness({ fillers: [{ kind: 'other_note', noteHe: 'x' }] });
  const a = await runConfirmationOnWon({ dealId: 'd1', transitionKey: KEY }, { db: h.db, log: h.log });
  const b = await runConfirmationOnWon({ dealId: 'd1', transitionKey: KEY }, { db: h.db, log: h.log });
  assert.equal(a.cardCreated, true);
  assert.equal(b.cardCreated, false, 'the dedupeKey collided — no second card');
  assert.equal(h.cards.length, 1);
});

test('a re-won deal (new wonAt ⇒ new key) legitimately gets its own card', async () => {
  const h = harness({ fillers: [{ kind: 'other_note', noteHe: 'x' }] });
  await runConfirmationOnWon({ dealId: 'd1', transitionKey: KEY }, { db: h.db, log: h.log });
  await runConfirmationOnWon(
    { dealId: 'd1', transitionKey: 'won_transition:d1:1767312000000' },
    { db: h.db, log: h.log },
  );
  assert.equal(h.cards.length, 2);
});

test('a missing deal is a no-op, never a throw into the WON caller', async () => {
  const h = harness();
  h.db.deal.findUnique = async () => null;
  const out = await runConfirmationOnWon({ dealId: 'gone', transitionKey: KEY }, { db: h.db, log: h.log });
  assert.equal(out.skipped, 'deal_not_found');
});

test('a hook failure is swallowed — WON never breaks because of email', async () => {
  const h = harness();
  h.db.deal.findUnique = async () => { throw new Error('db down'); };
  const out = await runConfirmationOnWon({ dealId: 'd1', transitionKey: KEY }, { db: h.db, log: h.log });
  assert.equal(out.error, 'hook_failed');
});

test('suppressed (preview-driven WON) → GUARD card instead of a silent skip', async () => {
  const h = harness();
  const out = await runConfirmationOnWon(
    { dealId: 'd1', transitionKey: KEY, closedByUserId: 'user_1', suppressed: true },
    { db: h.db, log: h.log },
  );
  assert.equal(out.suppressed, true);
  assert.equal(out.pendingReview, true);
  assert.equal(h.scheduled.length, 0, 'the preview owns the send — nothing queued');
  assert.equal(h.cards.length, 1);
  assert.equal(h.cards[0].data.suppressedPreviewSend, true);
  assert.match(h.cards[0].summary, /התצוגה המקדימה/);
  // The preview's real send resolves the guard seconds later.
  const r = await resolveConfirmationReview('s1', 'd1', { userId: 'user_1' }, { db: h.db });
  assert.equal(r.resolved, true);
});

test('auto-send failure → review card + deal-feed event, never invisible (#26107)', async () => {
  const h = harness(); // no fillers → the hook TRIES to auto-send
  const timeline = [];
  // No templates configured → composeConfirmationEmail returns a clean error.
  h.db.confirmationEmailTemplate = { findMany: async () => [] };
  h.db.openTourTemplate = { findUnique: async () => null };
  h.db.timelineEntry = { create: async ({ data }) => { const r = { id: `tl${timeline.length + 1}`, createdAt: new Date(), ...data }; timeline.push(r); return r; } };
  h.db.$executeRaw = async () => 0;
  const out = await runConfirmationOnWon(
    { dealId: 'd1', transitionKey: KEY, closedByUserId: 'user_1' },
    { db: h.db, log: h.log },
  );
  assert.equal(out.sent, false);
  assert.ok(out.error, 'the auto-send failed');
  assert.equal(h.cards.length, 1, 'the failure raised a review card');
  assert.match(h.cards[0].title, /לא נשלח אוטומטית/);
  assert.ok(timeline.some((t) => t.data?.event === 'confirmation_email_auto_failed'), 'and a visible deal-feed event');
});

test('send blocked by a missing tour → card + feed name the REAL cause (#27074)', async () => {
  const h = harness(); // no fillers → the hook TRIES to auto-send
  const timeline = [];
  // A full-enough deal for the composer: WON, a contact with an email, but NO
  // booking — the meeting point cannot resolve, exactly production #27074.
  h.db.deal.findUnique = async () => ({
    id: 'd1', orderNo: 27074, status: 'won',
    tourDate: '2026-08-25', tourTime: '10:00', participants: 3,
    productId: null, locationId: null, product: null, location: null,
    organization: null, organizationType: null,
    contacts: [{
      isPrimary: true,
      contact: {
        id: 'c1', firstNameHe: 'איילת', lastNameHe: 'צליג', firstNameEn: 'Ayelet', lastNameEn: 'Z',
        communicationLanguage: 'he',
        emails: [{ value: 'a@example.com', isPrimary: true }], phones: [],
      },
    }],
    bookings: [],
    confirmation: { fillers: null, overrideState: null },
  });
  h.db.confirmationEmailTemplate = {
    findMany: async () => [{
      id: 't1', internalName: 'מייל אישור סטנדרטי', isDefault: true, active: true,
      productIds: [], activityTypes: [], orgTypeIds: [], priority: 0,
      subjectHe: 'נושא', subjectEn: null,
      greetingHe: null, greetingEn: null, closingHe: null, closingEn: null,
      sections: [
        { kind: 'auto', key: 'greeting' },
        { kind: 'auto', key: 'meeting_point' },
        { kind: 'auto', key: 'closing' },
      ],
      blockLinks: [],
    }],
  };
  // The layout normalizer appends every auto section — give cancellation its
  // ★ default so the ONLY blocking warning left is the missing tour.
  h.db.confirmationSpecialText = {
    findMany: async () => [{
      id: 'st1', category: 'cancellation_policy', internalName: 'מדיניות רגילה',
      internalNote: null, bodyHe: '<p>מדיניות ביטול</p>', bodyEn: null, active: true, isDefault: true,
    }],
  };
  h.db.quoteTemplate = { findUnique: async () => null };
  h.db.openTourTemplate = { findUnique: async () => null };
  h.db.timelineEntry = { create: async ({ data }) => { const r = { id: `tl${timeline.length + 1}`, createdAt: new Date(), ...data }; timeline.push(r); return r; } };
  h.db.$executeRaw = async () => 0;

  const out = await runConfirmationOnWon(
    { dealId: 'd1', transitionKey: KEY, closedByUserId: null },
    { db: h.db, log: h.log },
  );
  assert.equal(out.sent, false);
  assert.equal(out.error, 'send_blocked');
  assert.equal(h.scheduled.length, 0, 'nothing queued');
  // The card and the feed carry the ACTUAL reason — not the generic
  // language label that misled the #27074 investigation.
  assert.match(h.cards[0].summary, /אין סיור משובץ — נקודת המפגש חסרה/);
  assert.doesNotMatch(h.cards[0].summary, /חסר תוכן או משתנה בשפת השליחה/);
  assert.equal(h.cards[0].data.autoSendError, 'send_blocked');
  assert.equal(h.cards[0].data.autoSendWarnings.length, 1);
  assert.equal(h.cards[0].data.autoSendWarnings[0].code, 'no_tour');
  const feed = timeline.find((t) => t.data?.event === 'confirmation_email_auto_failed');
  assert.equal(feed.data.errorHe, 'אין סיור משובץ — נקודת המפגש חסרה');
});

test('a real send resolves the open review card (no stuck state)', async () => {
  const h = harness({ fillers: [{ kind: 'other_note', noteHe: 'x' }] });
  await runConfirmationOnWon({ dealId: 'd1', transitionKey: KEY }, { db: h.db, log: h.log });
  assert.equal(h.cards[0].status, 'open');
  const r = await resolveConfirmationReview('s1', 'd1', { userId: 'u1' }, { db: h.db });
  assert.equal(r.resolved, true);
  assert.equal(h.cards[0].status, 'handled');
  // second call is a harmless no-op
  assert.equal((await resolveConfirmationReview('s1', 'd1', null, { db: h.db })).resolved, false);
});
