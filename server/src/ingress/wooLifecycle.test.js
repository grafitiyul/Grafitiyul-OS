import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './testDb.js';
import { ingest } from './pipeline.js';
import { buildIdempotencyKey } from './identity.js';
import { wooAdapter, isPaidStatus, statusMeaning, wooEventHash, normalizeStatus } from './adapters/woocommerce.js';

// ── The WooCommerce order lifecycle ─────────────────────────────────────────
//
// Every Woo order reaches GOS and becomes a Deal, paid or not. What changes
// with the status is the Deal's business state and the pinned internal note —
// never whether the event is kept, and never how many Deals exist.
//
// Two identities are under test here, and they must stay separate:
//   stable  (store + order id)          → always the same Deal
//   event   (canonical content hash)    → has this exact state been processed?

const STORE = 'primary';

// A realistic Woo order payload. `over` patches the top level.
const wooOrder = (over = {}) => ({
  id: 5001,
  number: '5001',
  status: 'pending',
  currency: 'ILS',
  total: '450.00',
  discount_total: '50.00',
  total_tax: '0.00',
  date_created: '2026-08-04T09:00:00',
  date_modified: '2026-08-04T09:00:00',
  payment_method_title: 'כרטיס אשראי',
  created_via: 'checkout',
  customer_note: 'נגיע עם 12 ילדים',
  billing: {
    first_name: 'רונית', last_name: 'לוי',
    email: 'ronit@example.com', phone: '052-777-8888', company: '',
  },
  line_items: [{
    product_id: 88, variation_id: 91, name: 'סיור גרפיטי — תל אביב',
    sku: 'TLV-GRAF', quantity: 12, price: '37.5', total: '450.00',
    meta_data: [{ display_key: 'סוג סיור', display_value: 'קבוצתי' }],
  }],
  coupon_lines: [{ code: 'SUMMER10' }],
  meta_data: [{ key: '_billing_tour_date', value: '15/09/2026' }],
  ...over,
});

// Deliver one Woo webhook exactly the way routes/ingress.js does.
const deliver = (db, order) => ingest({
  source: wooAdapter.key,
  sourceKey: STORE,
  externalId: wooAdapter.orderIdOf(order),
  idempotencyKey: buildIdempotencyKey({
    source: wooAdapter.key, sourceKey: STORE,
    externalId: wooAdapter.orderIdOf(order),
    salt: wooEventHash(order),
  }),
  rawPayload: { order },
  canonicalEvent: wooAdapter.toCanonicalEvent(order, { storeKey: STORE }),
}, db);

const seed = () => createTestDb({
  dealStages: [
    { id: 'stage_lead', key: 'lead', label: 'ליד חדש', isActive: true, sortOrder: 0 },
    { id: 'stage_won', key: 'won', label: 'נסגר בהצלחה', isActive: true, sortOrder: 99 },
  ],
});

const deals = (db) => db._tables.deal;
const notes = (db) => db._tables.timelineEntry.filter((t) => t.kind === 'note');
const pinned = (db) => notes(db).filter((t) => t.isPinned);

// ── Status catalogue ────────────────────────────────────────────────────────

test('woo: on-hold is NOT paid — it is "awaiting payment"', () => {
  assert.equal(isPaidStatus('on-hold'), false, 'on-hold must never drive a WON transition');
  assert.equal(isPaidStatus('processing'), true);
  assert.equal(isPaidStatus('completed'), true);
  for (const s of ['pending', 'failed', 'cancelled', 'refunded', 'trash', 'checkout-draft']) {
    assert.equal(isPaidStatus(s), false, `${s} must not be paid`);
  }
});

test('woo: statuses normalize, and an unknown status is reported verbatim', () => {
  assert.equal(normalizeStatus('wc-processing'), 'processing');
  assert.equal(normalizeStatus(' Completed '), 'completed');
  const m = statusMeaning('awaiting-shipment-x');
  assert.equal(m.known, false);
  assert.match(m.title, /awaiting-shipment-x/, 'an unknown status is shown, not bucketed');
});

// ── Every status creates a Deal ─────────────────────────────────────────────

test('woo: EVERY status creates a Deal — non-paid orders are never dropped', async () => {
  for (const status of ['pending', 'checkout-draft', 'failed', 'on-hold', 'cancelled', 'refunded', 'processing', 'completed']) {
    const db = seed();
    const r = await deliver(db, wooOrder({ status }));
    assert.equal(r.status, 'processed', `${status}: must process`);
    assert.equal(r.outcome, 'created_deal', `${status}: must create a deal`);
    assert.equal(deals(db).length, 1, `${status}: exactly one deal`);
    assert.equal(deals(db)[0].activityType, 'group', `${status}: a Woo order is group, paid or not`);
    assert.equal(pinned(db).length, 1, `${status}: one pinned system note`);
  }
});

test('woo: the pinned note states it is automatic and never sent to the customer', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending' }));
  const note = pinned(db)[0];
  assert.equal(note.isSystem, true);
  assert.equal(note.actorType, 'system');
  assert.match(note.body, /הערה אוטומטית של המערכת/);
  assert.match(note.body, /לא נשלחת ללקוח/);
});

test('woo: the note carries every field Woo actually sent — and invents nothing', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending' }));
  const body = pinned(db)[0].body;
  for (const [label, expected] of [
    ['order number', /5001/],
    ['status', /pending/],
    ['amount', /450\.00 ILS/],
    ['discount', /50\.00/],
    ['payment method', /כרטיס אשראי/],
    ['coupon', /SUMMER10/],
    ['tour date', /2026-09-15/],
    ['participants', /12/],
    ['product', /סיור גרפיטי — תל אביב/],
    ['variant meta', /סוג סיור: קבוצתי/],
    ['customer name', /רונית לוי/],
    ['phone', /972527778888/],
    ['email', /ronit@example\.com/],
    ['customer note', /נגיע עם 12 ילדים/],
    ['abandoned wording', /לא השלים תשלום/],
  ]) {
    assert.match(body, expected, `note must contain the ${label}`);
  }
  // Nothing invented: the payload carries no company, so no company line.
  assert.doesNotMatch(body, /חברה:/, 'a field Woo did not send must not appear');
});

// ── One order = one Deal, across the whole lifecycle ────────────────────────

test('woo: pending → processing → completed stays ONE deal, won exactly once', async () => {
  const db = seed();

  const r1 = await deliver(db, wooOrder({ status: 'pending' }));
  assert.equal(r1.outcome, 'created_deal');
  assert.equal(deals(db)[0].status, 'open', 'unpaid stays open');

  const r2 = await deliver(db, wooOrder({ status: 'processing', date_paid: '2026-08-04T10:00:00' }));
  assert.equal(r2.outcome, 'updated_order_deal', 'a transition UPDATES, never creates');
  assert.equal(deals(db).length, 1, 'still exactly one deal');
  assert.equal(deals(db)[0].status, 'won', 'paid ⇒ WON through the canonical transition');
  assert.equal(deals(db)[0].dealStageId, 'stage_won', 'and moved to the final stage');
  assert.ok(deals(db)[0].wonAt, 'wonAt stamped');
  assert.equal(r2.won.wonNow, true, 'this delivery is the genuine transition');

  const wonAt = deals(db)[0].wonAt;
  const r3 = await deliver(db, wooOrder({ status: 'completed', date_paid: '2026-08-04T10:00:00', date_completed: '2026-08-04T11:00:00' }));
  assert.equal(r3.outcome, 'updated_order_deal');
  assert.equal(deals(db).length, 1);
  assert.equal(r3.won.wonNow, false, 'the second paid delivery must NOT win again');
  assert.equal(deals(db)[0].wonAt, wonAt, 'wonAt is not restamped');

  assert.equal(pinned(db).length, 3, 'one pinned note per real transition');
  assert.match(pinned(db)[1].body, /pending.*←.*processing|processing/s);
});

test('woo: pending → cancelled stays ONE deal and stays OPEN', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending' }));
  const r = await deliver(db, wooOrder({ status: 'cancelled' }));

  assert.equal(r.outcome, 'updated_order_deal');
  assert.equal(deals(db).length, 1);
  assert.equal(deals(db)[0].status, 'open', 'a cancellation never auto-LOSES the deal');
  assert.match(pinned(db)[1].body, /ההזמנה בוטלה/);
});

test('woo: a refund AFTER payment leaves the deal WON, with a loud note', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'processing' }));
  assert.equal(deals(db)[0].status, 'won');

  const r = await deliver(db, wooOrder({ status: 'refunded' }));
  assert.equal(r.outcome, 'updated_order_deal');
  assert.equal(deals(db).length, 1);
  assert.equal(deals(db)[0].status, 'won', 'a webhook must never silently reverse a win');
  assert.match(pinned(db).at(-1).body, /זוכתה/);
  assert.match(pinned(db).at(-1).body, /לטיפול המשרד/);
});

test('woo: trash does not change the business status', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending' }));
  await deliver(db, wooOrder({ status: 'trash' }));
  assert.equal(deals(db).length, 1);
  assert.equal(deals(db)[0].status, 'open');
  assert.match(pinned(db).at(-1).body, /אשפה/);
});

test('woo: on-hold does NOT win the deal', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'on-hold' }));
  assert.equal(deals(db)[0].status, 'open', 'awaiting payment is not payment');
  assert.equal(deals(db)[0].activityType, 'group');
});

// ── Event identity: retries vs real changes ─────────────────────────────────

test('woo: an identical retry does nothing twice', async () => {
  const db = seed();
  const order = wooOrder({ status: 'pending' });
  const first = await deliver(db, order);
  assert.equal(first.outcome, 'created_deal');

  for (let i = 0; i < 5; i++) {
    const again = await deliver(db, order);
    assert.equal(again.status, 'duplicate', 'a byte-identical retry is a duplicate');
  }
  assert.equal(deals(db).length, 1);
  assert.equal(pinned(db).length, 1, 'no note noise from retries');
});

test('woo: a no-op Woo save (only date_modified changes) is a duplicate', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending' }));
  const r = await deliver(db, wooOrder({ status: 'pending', date_modified: '2026-08-04T23:59:00' }));
  assert.equal(r.status, 'duplicate', 'churn must not create timeline noise');
  assert.equal(pinned(db).length, 1);
});

test('woo: a MEANINGFUL edit at the same status updates the same deal', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending' }));

  // The customer moved the tour date and added participants — same status.
  const edited = wooOrder({
    status: 'pending',
    total: '600.00',
    meta_data: [{ key: '_billing_tour_date', value: '20/09/2026' }],
    line_items: [{
      product_id: 88, variation_id: 91, name: 'סיור גרפיטי — תל אביב',
      sku: 'TLV-GRAF', quantity: 16, price: '37.5', total: '600.00', meta_data: [],
    }],
  });
  const r = await deliver(db, edited);

  assert.equal(r.status, 'processed', 'a real edit must NOT be dropped');
  assert.equal(r.outcome, 'updated_order_deal');
  assert.equal(deals(db).length, 1, 'and must not create a second deal');
  assert.equal(deals(db)[0].tourDate, '2026-09-20', 'the new date reached the deal');
  assert.equal(deals(db)[0].participants, 16);
  assert.equal(deals(db)[0].valueMinor, 60000n);
});

test('woo: the event hash reacts to meaning, not to churn', () => {
  const base = wooOrder({ status: 'pending' });
  assert.equal(wooEventHash(base), wooEventHash(wooOrder({ status: 'pending' })), 'stable');
  assert.equal(
    wooEventHash(base),
    wooEventHash(wooOrder({ status: 'pending', date_modified: '2026-12-31T00:00:00' })),
    'date_modified alone is churn',
  );
  assert.notEqual(wooEventHash(base), wooEventHash(wooOrder({ status: 'processing' })), 'status matters');
  assert.notEqual(wooEventHash(base), wooEventHash(wooOrder({ total: '999.00' })), 'amount matters');
  assert.notEqual(
    wooEventHash(base),
    wooEventHash(wooOrder({ meta_data: [{ key: '_billing_tour_date', value: '01/01/2027' }] })),
    'tour date matters',
  );
});

// ── A genuinely different order ─────────────────────────────────────────────

test('woo: a genuinely NEW order id creates a second deal, even for the same person', async () => {
  const db = seed();
  await deliver(db, wooOrder({ id: 5001, number: '5001', status: 'processing' }));
  await deliver(db, wooOrder({ id: 7777, number: '7777', status: 'processing' }));

  assert.equal(deals(db).length, 2, 'two purchases are two deals');
  assert.equal(db._tables.contact.length, 1, 'but only one contact — same person');
});

test('woo: two stores with the same order number never collide', async () => {
  const db = seed();
  const order = wooOrder({ status: 'processing' });
  await deliver(db, order);
  await ingest({
    source: wooAdapter.key,
    sourceKey: 'secondary',
    externalId: '5001',
    idempotencyKey: buildIdempotencyKey({
      source: wooAdapter.key, sourceKey: 'secondary', externalId: '5001', salt: wooEventHash(order),
    }),
    rawPayload: { order },
    canonicalEvent: wooAdapter.toCanonicalEvent(order, { storeKey: 'secondary' }),
  }, db);

  assert.equal(deals(db).length, 2, 'order 5001 in store A is not order 5001 in store B');
});

// ── Orders never dedupe by person ───────────────────────────────────────────

test('woo: an order is never merged into a recent LEAD from the same person', async () => {
  const db = seed();
  // The same person submitted a website lead moments ago.
  await ingest({
    source: 'website_form',
    rawPayload: {},
    canonicalEvent: {
      kind: 'lead', source: 'website_form', sourceKey: null, externalId: null,
      occurredAt: new Date(),
      person: { fullName: 'רונית לוי', phone: '052-777-8888', email: 'ronit@example.com' },
      organization: null, order: null,
      context: { message: 'מתעניינת' }, attributionInput: null, extra: {},
    },
  }, db);
  assert.equal(deals(db).length, 1);

  await deliver(db, wooOrder({ status: 'processing' }));
  assert.equal(deals(db).length, 2, 'a purchase is revenue, not a duplicate lead');
  assert.equal(deals(db)[1].activityType, 'group');
});
