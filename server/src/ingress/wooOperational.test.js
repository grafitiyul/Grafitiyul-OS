import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedWooCatalog } from './testDb.js';
import { ingest } from './pipeline.js';
import { buildIdempotencyKey } from './identity.js';
import { wooAdapter, wooEventHash } from './adapters/woocommerce.js';

// ── The Woo OPERATIONAL chain ───────────────────────────────────────────────
//
// A paid order must become everything an operator would have produced by hand:
// the canonical Group Ticket Builder quote, the WON transition, the Booking,
// the confirmed TicketRegistration (the seat SSOT), the payment evidence — and
// a replayed webhook must converge on every one of them.
//
// The catalog seeded here mirrors production: one Pricing Card priced per
// ticket type, one scheduled group slot, one WooVariationLink per (occurrence,
// card, ticket type) — the exact rows the outbound sync maintains.

const STORE = 'primary';

const wooOrder = (over = {}) => ({
  id: 6001,
  number: '6001',
  status: 'processing',
  currency: 'ILS',
  total: '350.00',
  date_created: '2026-08-05T09:00:00',
  date_paid: '2026-08-05T09:01:00',
  payment_method_title: 'כרטיס אשראי',
  billing: {
    first_name: 'רונית', last_name: 'לוי',
    email: 'ronit@example.com', phone: '052-777-8888', company: '',
  },
  line_items: [
    { product_id: 167, variation_id: 2108, name: 'סיור גרפיטי תל אביב — מבוגר', quantity: 2, price: '100', total: '200.00', meta_data: [] },
    { product_id: 167, variation_id: 2109, name: 'סיור גרפיטי תל אביב — ילד', quantity: 3, price: '50', total: '150.00', meta_data: [] },
  ],
  coupon_lines: [],
  meta_data: [{ key: '_billing_tour_date', value: '15/09/2026' }],
  ...over,
});

// A faithful stand-in for the canonical issueDocument: idempotent on the key,
// persists an IcountDocument row, records the exact input for assertions.
// `fail` makes it throw a coded error (the iCount-down scenario).
const fakeIssuer = ({ fail = null } = {}) => async (client, _deal, input) => {
  const existing = await client.icountDocument.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { doc: existing, reused: true };
  if (fail) {
    const e = new Error(fail);
    e.code = fail;
    throw e;
  }
  const grossIls = (input.rows || []).reduce((s, r) => s + (r.quantity || 0) * (r.unitPriceIls || 0), 0);
  const doc = await client.icountDocument.create({
    data: {
      provider: 'icount', source: input.source || 'user', doctype: input.doctype,
      docnum: String(9000 + (client._tables?.icountDocument.length || 0)),
      idempotencyKey: input.idempotencyKey,
      amountMinor: BigInt(Math.round(grossIls * 100)),
      currency: input.currency || 'ILS',
      clientName: input.client?.name || '', status: 'issued', issuedAt: new Date(),
      _input: input,
    },
  });
  return { doc, reused: false };
};

const deliver = (db, order, { issueDoc = fakeIssuer() } = {}) => ingest({
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
  issueDoc,
}, db);

const seed = () => {
  const db = createTestDb({
    dealStages: [
      { id: 'stage_lead', key: 'lead', label: 'ליד חדש', isActive: true, sortOrder: 0 },
      { id: 'stage_won', key: 'won', label: 'נסגר בהצלחה', isActive: true, sortOrder: 99 },
    ],
  });
  seedWooCatalog(db);
  return db;
};

const t = (db) => db._tables;
const theDeal = (db) => t(db).deal[0];
const groupLines = (db) => t(db).quoteLine.filter((l) => l.sourceKind === 'group_ticket');

// ── The full paid-order happy path ──────────────────────────────────────────

test('woo operational: a paid order becomes a complete operational deal', async () => {
  const db = seed();
  const r = await deliver(db, wooOrder());
  assert.equal(r.status, 'processed');

  // Deal — WON, with the Builder's headline fields exactly as an operator save.
  const deal = theDeal(db);
  assert.equal(deal.status, 'won');
  assert.equal(deal.valueMinor, 35000n, 'value = the composed gross = the paid total');
  assert.equal(deal.participants, 5, 'participants = total tickets');
  assert.equal(deal.productId, 'prod_1', 'deal product = first card product');
  assert.equal(deal.productVariantId, 'pv_1');

  // Quote — byte-shape parity with the Group Ticket Builder.
  const lines = groupLines(db);
  assert.equal(lines.length, 2);
  const [adult, child] = lines;
  assert.equal(adult.kind, 'manual');
  assert.equal(adult.label, 'סיור גרפיטי תל אביב — מבוגר');
  assert.equal(adult.quantity, 2);
  assert.equal(adult.unitPriceMinor, 10000n);
  assert.equal(adult.vatMode, 'included', 'card VAT, explicitly on the line');
  assert.equal(adult.sourceCardGroupId, 'card_1');
  assert.equal(adult.ticketTypeId, 'tt_adult');
  assert.equal(adult.productVariantId, 'pv_1', 'the card variant drives operational derivation');
  assert.equal(child.label, 'סיור גרפיטי תל אביב — ילד');
  assert.equal(child.quantity, 3);
  assert.equal(child.unitPriceMinor, 5000n);

  // Booking + registration — the seat SSOT.
  assert.equal(t(db).booking.length, 1);
  const booking = t(db).booking[0];
  assert.equal(booking.tourEventId, 'tour_1');
  assert.equal(booking.seats, 5);
  assert.equal(booking.status, 'active');

  assert.equal(t(db).ticketRegistration.length, 1);
  const reg = t(db).ticketRegistration[0];
  assert.equal(reg.source, 'deal', 'canonical deal registration — visible to every existing filter');
  assert.equal(reg.tourEventId, 'tour_1');
  assert.equal(reg.quantity, 5, 'capacity consumed = seats bought');
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.paymentStatus, 'paid');
  assert.equal(reg.productVariantId, 'pv_1');
  assert.deepEqual(
    (reg.ticketBreakdown || []).map((b) => ({ ticketTypeId: b.ticketTypeId, quantity: b.quantity })),
    [{ ticketTypeId: 'tt_adult', quantity: 2 }, { ticketTypeId: 'tt_child', quantity: 3 }],
    'the purchased composition is frozen on the registration',
  );

  // Money — exactly ONE חשבונית מס קבלה, derived from the composed quote,
  // equal to the paid amount; the fallback evidence row is never written when
  // the document exists (money counts once).
  assert.equal(t(db).icountDocument.length, 1);
  const doc = t(db).icountDocument[0];
  assert.equal(doc.doctype, 'invrec');
  assert.equal(doc.idempotencyKey, 'woo:primary:6001:invrec');
  assert.equal(doc.amountMinor, 35000n, 'document total = paid total');
  assert.equal(doc.source, 'webhook');
  const input = doc._input;
  assert.equal(input.sendEmail, false, 'no auto email — operator sends explicitly');
  assert.equal(input.lang, 'he');
  assert.equal(input.vatMode, 'included');
  assert.equal(input.payments.length, 1);
  assert.equal(input.payments[0].method, 'cc');
  assert.equal(input.payments[0].amount, 350);
  assert.equal(input.rows.length, 2, 'document rows = the composed Builder lines');
  assert.match(input.rows[0].description, /מבוגר/);
  assert.equal(t(db).dealCollectionEvidence.length, 0, 'no double money row beside the document');

  // Nothing needed attention.
  assert.equal(t(db).reviewItem.length, 0);
  assert.deepEqual(r.operational.reasons, []);
});

// ── Idempotency: replays converge on every layer ────────────────────────────

test('woo operational: replaying the paid webhook duplicates NOTHING', async () => {
  const db = seed();
  await deliver(db, wooOrder());

  // Byte-identical retry → duplicate at the event layer.
  const again = await deliver(db, wooOrder());
  assert.equal(again.status, 'duplicate');

  // A REAL later transition (completed) re-runs the whole chain — and converges.
  const r = await deliver(db, wooOrder({ status: 'completed', date_completed: '2026-08-05T11:00:00' }));
  assert.equal(r.status, 'processed');

  assert.equal(t(db).deal.length, 1, 'one deal');
  assert.equal(t(db).booking.length, 1, 'one booking');
  assert.equal(t(db).ticketRegistration.length, 1, 'one registration');
  assert.equal(t(db).icountDocument.length, 1, 'one invrec — processing → completed never issues twice');
  assert.equal(r.operational.doc.reused, true, 'the replay reuses the SAME document');
  assert.equal(t(db).dealCollectionEvidence.length, 0);
  assert.equal(groupLines(db).length, 2, 'quote not duplicated');
  assert.equal(r.operational.settle.alreadyWon, true, 'WON exactly once');
});

// ── Money truth: coupons reconcile via an explicit discount line ────────────

test('woo operational: a coupon becomes an explicit discount line and the totals match the paid amount', async () => {
  const db = seed();
  await deliver(db, wooOrder({ total: '300.00', coupon_lines: [{ code: 'SUMMER50' }] }));

  const deal = theDeal(db);
  assert.equal(deal.status, 'won');
  assert.equal(deal.valueMinor, 30000n, 'deal value = what the customer actually paid');

  const adjustment = t(db).quoteLine.find((l) => l.sourceKind === 'woo_adjustment');
  assert.ok(adjustment, 'the gap is an explicit line, never silent');
  assert.equal(adjustment.kind, 'discount');
  assert.equal(adjustment.unitPriceMinor, 5000n);
  assert.match(adjustment.label, /SUMMER50/);

  assert.equal(t(db).icountDocument[0].amountMinor, 30000n, 'document = paid amount → collection settles to zero');
  assert.equal(t(db).icountDocument[0]._input.rows.length, 3, 'the discount line is ON the document');
  assert.equal(t(db).reviewItem.length, 0, 'a coupon is normal business, not an attention card');
});

// ── Unpaid orders: quote yes, operational effects no ────────────────────────

test('woo operational: an unpaid order composes the quote but stays open with no booking and no money', async () => {
  const db = seed();
  const r = await deliver(db, wooOrder({ status: 'pending', date_paid: null }));
  assert.equal(r.status, 'processed');

  const deal = theDeal(db);
  assert.equal(deal.status, 'open');
  assert.equal(deal.valueMinor, 35000n, 'the Builder is ready before payment');
  assert.equal(groupLines(db).length, 2);
  assert.equal(t(db).booking.length, 0);
  assert.equal(t(db).ticketRegistration.length, 0);
  assert.equal(t(db).dealCollectionEvidence.length, 0);
  assert.equal(t(db).icountDocument.length, 0, 'no document before money moved');
});

test('woo operational: an order edit before payment recomposes; payment then settles the FINAL state', async () => {
  const db = seed();
  await deliver(db, wooOrder({ status: 'pending', date_paid: null }));

  // The customer added two adults.
  const edited = wooOrder({
    status: 'pending',
    date_paid: null,
    total: '550.00',
    line_items: [
      { product_id: 167, variation_id: 2108, name: 'מבוגר', quantity: 4, price: '100', total: '400.00', meta_data: [] },
      { product_id: 167, variation_id: 2109, name: 'ילד', quantity: 3, price: '50', total: '150.00', meta_data: [] },
    ],
  });
  await deliver(db, edited);
  assert.equal(theDeal(db).valueMinor, 55000n);
  assert.equal(theDeal(db).participants, 7);
  assert.equal(groupLines(db).find((l) => l.ticketTypeId === 'tt_adult').quantity, 4);

  await deliver(db, wooOrder({ ...edited, status: 'processing', date_paid: '2026-08-05T12:00:00' }));
  assert.equal(theDeal(db).status, 'won');
  assert.equal(t(db).booking[0].seats, 7, 'the booking reflects the edited order');
  assert.equal(t(db).ticketRegistration[0].quantity, 7);
});

// ── Failure is loud, never silent ───────────────────────────────────────────

test('woo operational: an unresolvable line WONs the paid deal WITHOUT a tour and raises ONE attention card', async () => {
  const db = seed();
  const order = wooOrder({
    line_items: [
      { product_id: 999, variation_id: 4444, name: 'מוצר לא ממופה', quantity: 5, price: '70', total: '350.00', meta_data: [] },
    ],
  });
  const r = await deliver(db, order);

  const deal = theDeal(db);
  assert.equal(deal.status, 'won', 'the money is real — the deal never stays open');
  assert.equal(t(db).booking.length, 0, 'no guessed tour');
  assert.equal(t(db).ticketRegistration.length, 0);
  assert.equal(groupLines(db).length, 0, 'no guessed quote');
  // The invrec still issues — same as an operator would: the generic single
  // row (deal value = paid total), never Deal.title, never invented tickets.
  assert.equal(t(db).icountDocument.length, 1, 'the payment is still documented');
  assert.equal(t(db).icountDocument[0].amountMinor, 35000n);
  assert.equal(t(db).dealCollectionEvidence.length, 0);
  assert.ok(r.operational.reasons.includes('lines_unresolved'));

  const cards = t(db).reviewItem;
  assert.equal(cards.length, 1, 'exactly one attention card');
  assert.equal(cards[0].kind, 'woo_order_attention');
  assert.equal(cards[0].dealId, deal.id);

  // Replaying the same problem converges on the SAME card.
  await deliver(db, { ...order, status: 'completed' });
  assert.equal(t(db).reviewItem.length, 1);
});

test('woo operational: an order spanning TWO tour dates is never guessed onto one of them', async () => {
  const db = seed();
  seedWooCatalog(db, {
    tourEventId: 'tour_2', cardGroupId: 'card_1',
    adultVariationId: 3108, childVariationId: 3109,
  });
  const r = await deliver(db, wooOrder({
    line_items: [
      { product_id: 167, variation_id: 2108, name: 'מבוגר 15.9', quantity: 2, price: '100', total: '200.00', meta_data: [] },
      { product_id: 167, variation_id: 3108, name: 'מבוגר 22.9', quantity: 1, price: '100', total: '100.00', meta_data: [] },
    ],
    total: '300.00',
  }));

  assert.equal(theDeal(db).status, 'won');
  assert.equal(t(db).booking.length, 0, 'a split order needs a human decision');
  assert.ok(r.operational.reasons.includes('multi_tour_order'));
  assert.equal(t(db).reviewItem.length, 1);
});

test('woo operational: a Builder a human already edited is NEVER clobbered', async () => {
  const db = seed();
  // The operator built a custom quote on this deal before the webhook ran again.
  await deliver(db, wooOrder({ status: 'pending', date_paid: null }));
  const version = t(db).quoteVersion[0];
  t(db).quoteLine = [{
    id: 'ql_custom', quoteVersionId: version.id, kind: 'manual', label: 'מחיר מיוחד שסוכם טלפונית',
    quantity: 1, unitPriceMinor: 99900n, vatMode: 'included', vatRate: null,
    active: true, overridden: true, sourceKind: null, sourceCardGroupId: null,
    ticketTypeId: null, productVariantId: null, sortOrder: 0, note: null,
  }];
  const manualValue = theDeal(db).valueMinor;

  const r = await deliver(db, wooOrder({ status: 'processing' }));
  assert.equal(theDeal(db).status, 'won', 'payment still settles');
  assert.equal(t(db).quoteLine.length, 1, 'the human quote survives untouched');
  assert.equal(t(db).quoteLine[0].label, 'מחיר מיוחד שסוכם טלפונית');
  assert.equal(theDeal(db).valueMinor, manualValue, 'the human value survives');
  assert.ok(r.operational.reasons.includes('builder_human_edited'));
  // The edited Builder (₪999) no longer describes the ₪350 that moved — a
  // document would state a false accounting fact, so NONE is issued; the money
  // lands as fallback evidence and the card tells the office.
  assert.equal(t(db).icountDocument.length, 0, 'no document whose total ≠ the paid amount');
  assert.ok(r.operational.reasons.some((x) => x === 'doc_issue_failed:doc_amount_mismatch'));
  assert.equal(t(db).dealCollectionEvidence.length, 1, 'the money is still recorded');
  assert.equal(t(db).reviewItem.length, 1, 'the office is told to verify the quote matches the order');
});

// ── Document idempotency + failure recovery ─────────────────────────────────

test('woo operational: iCount down → loud fallback; recovery replay issues ONCE and supersedes the evidence', async () => {
  const db = seed();
  const r1 = await deliver(db, wooOrder(), { issueDoc: fakeIssuer({ fail: 'icount_timeout' }) });

  // Failure is loud, money is safe, WON is not blocked.
  assert.equal(theDeal(db).status, 'won');
  assert.equal(t(db).icountDocument.length, 0);
  assert.equal(t(db).dealCollectionEvidence.length, 1, 'fallback evidence keeps the balance truthful');
  assert.equal(t(db).dealCollectionEvidence[0].status, 'active');
  assert.ok(r1.operational.reasons.some((x) => x.startsWith('doc_issue_failed')));
  assert.equal(t(db).reviewItem.length, 1, 'doc failure raises a review card');

  // iCount recovers; the next REAL transition replays the chain.
  const r2 = await deliver(db, wooOrder({ status: 'completed' }));
  assert.equal(t(db).icountDocument.length, 1, 'the document is issued exactly once');
  assert.equal(r2.operational.doc.ok, true);
  assert.equal(t(db).dealCollectionEvidence[0].status, 'reversed', 'the evidence is superseded — money counts once');
  assert.match(t(db).dealCollectionEvidence[0].reversalReason, /חשבונית מס קבלה/);

  // And a further replay changes nothing.
  await deliver(db, wooOrder({ status: 'completed', date_completed: '2026-08-06T09:00:00' }));
  assert.equal(t(db).icountDocument.length, 1);
  assert.equal(t(db).dealCollectionEvidence.length, 1);
});

test('woo operational: a concurrent double-issue (P2002 race) converges on the winner document — no evidence, no card', async () => {
  const db = seed();
  // The LOSER of a race: by the time its create runs, the winner's row exists.
  const racingIssuer = async (client, _deal, input) => {
    await client.icountDocument.create({
      data: {
        doctype: 'invrec', docnum: '7777', idempotencyKey: input.idempotencyKey,
        amountMinor: 35000n, currency: 'ILS', status: 'issued', source: 'webhook', clientName: 'רונית לוי',
      },
    });
    const e = new Error('Unique constraint failed');
    e.code = 'P2002';
    throw e;
  };
  const r = await deliver(db, wooOrder(), { issueDoc: racingIssuer });

  assert.equal(t(db).icountDocument.length, 1, 'exactly one document survives the race');
  assert.equal(r.operational.doc.ok, true, 'the loser converges on the winner');
  assert.equal(r.operational.doc.reused, true);
  assert.equal(t(db).dealCollectionEvidence.length, 0, 'no fallback evidence beside the winner document');
  assert.deepEqual(r.operational.reasons, [], 'a converged race is not an attention case');
});

test('woo operational: a refund AFTER an issued invrec raises a credit-document card, never rewrites the document', async () => {
  const db = seed();
  await deliver(db, wooOrder());
  assert.equal(t(db).icountDocument.length, 1);

  const r = await deliver(db, wooOrder({ status: 'refunded' }));
  assert.equal(theDeal(db).status, 'won', 'a refund never silently reverses a win');
  assert.equal(t(db).icountDocument.length, 1, 'the original document is untouched');
  assert.ok(r.operational.reasons.includes('refund_credit_document_needed'));
  const card = t(db).reviewItem.find((c) => c.dedupeKey.includes('refund_credit_document_needed'));
  assert.ok(card, 'the office is told to handle the credit document');
});

// ── The slot vanished: money wins, tour goes to a human ─────────────────────

test('woo operational: a cancelled slot cannot be joined — the deal WONs without it and the office is told', async () => {
  const db = seed();
  t(db).tourEvent.find((e) => e.id === 'tour_1').status = 'cancelled';

  const r = await deliver(db, wooOrder());
  assert.equal(theDeal(db).status, 'won');
  assert.equal(t(db).booking.length, 0);
  assert.ok(r.operational.reasons.some((x) => x.startsWith('tour_join_failed')));
  assert.equal(t(db).reviewItem.length, 1);
});
