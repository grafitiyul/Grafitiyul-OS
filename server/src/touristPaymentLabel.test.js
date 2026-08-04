// English label OWNERSHIP — the #26617 stale-label regression suite.
//
// The incident: the description was refreshed by identity-change DETECTION, so
// any write that updated identity and wording together (a QA restore, a script,
// a product changed and changed back between opens) froze stale wording
// forever. Deal #26617 advertised "Premium Graffiti Tour & Workshop Including
// Wall Mural" for a plain Tel Aviv graffiti tour. Ownership replaced detection.
// Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTouristDefaults,
  createOrReopenRequest,
  editRequest,
  syncPendingRequestWithDeal,
  ensureCurrentCardcomLowProfile,
} from './touristPayment.js';

// ── the real production shape of Deal #26617 (2026-08-04) ────────────────────
const DEAL_26617 = () => ({
  id: 'cef54153-a7e3-4108-baab-7240da0c4caa',
  orderNo: 26617,
  title: 'ליד חדש -דור קורן', // internal CRM wording — must never surface
  valueMinor: 100000n,
  currency: 'ILS',
  productId: 'cmqujpd210016qcpm3amrl115',
  productVariantId: 'cmquk1dau001nqcpmqf5lgeic',
  product: { nameHe: 'סיור גרפיטי', nameEn: 'Graffiti Tour' },
  productVariant: { agentDisplayNameEn: 'Graffiti Tour – Classic – 1.5 hours' },
  location: { nameHe: 'תל אביב - פלורנטין', nameEn: 'Tel Aviv - Florentine' },
  contacts: [],
  organization: null,
  quoteVersions: [{ id: 'cmsdf63ju000tagpqt2hfanc6', vatMode: 'exempt', lines: [] }],
});

// Slice G (owner decision 2026-08-04): the tourist Cardcom label is ONLY the
// product's plain English name — never the variant's commercial wording,
// duration, classic/special modifiers or location. #26617's correct label is
// therefore Product.nameEn ('Graffiti Tour'); the variant label below must
// NEVER appear on this surface.
const CANONICAL_26617 = 'Graffiti Tour';
const VARIANT_LABEL = 'Graffiti Tour – Classic – 1.5 hours';
const STALE = 'Premium Graffiti Tour & Workshop Including Wall Mural';

// The product the deal briefly carried on 2026-08-03 — the source of the stale
// string. Switching to it and back is the exact production sequence.
const PREMIUM_PRODUCT = {
  productId: 'cmqw720rt000he407s8e2juat',
  productVariantId: null,
  product: { nameHe: 'סיור וסדנת גרפיטי משודרגת כולל ציור קיר', nameEn: STALE },
  productVariant: null,
};

// ── minimal db double (only what these paths touch) ──────────────────────────
function makeDb(rows = []) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  let seq = rows.length;
  return {
    _store: store,
    paymentRequest: {
      async findUnique({ where }) {
        const row = where.id ? store.get(where.id) : [...store.values()].find((r) => r.token === where.token);
        return row ? { ...row } : null;
      },
      async findFirst({ where }) {
        const row = [...store.values()].find(
          (r) => r.dealId === where.dealId && (!where.status?.in || where.status.in.includes(r.status)),
        );
        return row ? { ...row } : null;
      },
      async create({ data }) {
        seq += 1;
        const row = { id: `req${seq}`, attemptNo: 1, ...data };
        store.set(row.id, row);
        return { ...row };
      },
      async update({ where, data }) {
        const row = store.get(where.id);
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }) {
        const row = store.get(where.id);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    timelineEntry: {
      async findFirst() { return null; },
      async create({ data }) { return { id: 't1', createdAt: new Date(), ...data }; },
      async update({ data }) { return data; },
    },
    async $executeRaw() { return 1; },
  };
}

const create = (db, deal, input) => createOrReopenRequest(db, deal, { productDescriptionEn: 'x', quantity: 1, ...input }, null);

// ── 1-4. the canonical label for #26617 ──────────────────────────────────────

test('#26617: the popup default is Product.nameEn ONLY — never variant wording, never the stale premium text', () => {
  const d = buildTouristDefaults(DEAL_26617());
  assert.equal(d.productDescriptionEn, CANONICAL_26617);
  assert.equal(d.productDescriptionEnSource, 'product');
  assert.notEqual(d.productDescriptionEn, STALE);
  assert.notEqual(d.productDescriptionEn, VARIANT_LABEL, 'the variant label belongs to agent documents, not this field');
});

test('auto-derived label stores the product name and stays auto', async () => {
  const db = makeDb();
  const { request } = await create(db, DEAL_26617(), { productDescriptionEn: CANONICAL_26617 });
  assert.equal(request.productDescriptionEn, CANONICAL_26617);
  assert.equal(request.productDescriptionSource, 'auto');
});

test('the variant English label is IGNORED even when present (product name wins)', async () => {
  const deal = DEAL_26617(); // carries agentDisplayNameEn — must not matter
  const db = makeDb();
  const { request } = await create(db, deal, { productDescriptionEn: 'anything' });
  assert.equal(request.productDescriptionEn, 'Graffiti Tour');
  assert.equal(request.productDescriptionSource, 'auto');
});

test('never falls back to Hebrew or to Deal.title', async () => {
  const deal = { ...DEAL_26617(), product: { nameHe: 'סיור גרפיטי', nameEn: null }, productVariant: null };
  const db = makeDb();
  const { request } = await create(db, deal, { productDescriptionEn: 'Custom English text' });
  // No canonical exists → the typed text is kept and honestly marked manual…
  assert.equal(request.productDescriptionEn, 'Custom English text');
  assert.equal(request.productDescriptionSource, 'operator');
  // …but never the Hebrew name and never the internal title.
  assert.notEqual(request.productDescriptionEn, deal.product.nameHe);
  assert.notEqual(request.productDescriptionEn, deal.title);
});

// ── 5-7. ownership ───────────────────────────────────────────────────────────

test('an intentional operator override persists across reads and Deal syncs', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, {
    productDescriptionEn: 'Private VIP Graffiti Experience',
    productDescriptionOverride: true,
  });
  assert.equal(request.productDescriptionSource, 'operator');

  const synced = await syncPendingRequestWithDeal(db, deal, request);
  assert.equal(synced.productDescriptionEn, 'Private VIP Graffiti Experience', 'a real override is never auto-refreshed');
});

test('a product/variant change REFRESHES an auto-derived label', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, { productDescriptionEn: CANONICAL_26617 });

  const switched = { ...deal, ...PREMIUM_PRODUCT };
  const after = await syncPendingRequestWithDeal(db, switched, request);
  assert.equal(after.productDescriptionEn, STALE, 'auto follows the deal');

  // …and switching BACK restores the canonical label — the exact #26617
  // sequence that used to leave the stale string frozen forever.
  const back = await syncPendingRequestWithDeal(db, deal, after);
  assert.equal(back.productDescriptionEn, CANONICAL_26617);
  assert.equal(back.productDescriptionSource, 'auto');
});

test('a product/variant change does NOT overwrite a true override', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, { productDescriptionEn: 'Agreed wording', productDescriptionOverride: true });
  const after = await syncPendingRequestWithDeal(db, { ...deal, ...PREMIUM_PRODUCT }, request);
  assert.equal(after.productDescriptionEn, 'Agreed wording');
});

// ── 8-9. reset, and the QA-restore hole that caused the incident ─────────────

test('reset-to-default clears ownership and restores the canonical label', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, { productDescriptionEn: 'Something custom', productDescriptionOverride: true });
  assert.equal(request.productDescriptionSource, 'operator');

  // What the "איפוס לברירת המחדל" button sends: the canonical text, no claim.
  const { request: reset } = await editRequest(db, deal, request, {
    productDescriptionEn: CANONICAL_26617,
    productDescriptionOverride: false,
    quantity: 1,
  }, null);
  assert.equal(reset.productDescriptionEn, CANONICAL_26617);
  assert.equal(reset.productDescriptionSource, 'auto');
});

test('THE INCIDENT: a QA/script write cannot convert auto into an operator override', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, { productDescriptionEn: CANONICAL_26617 });

  // Exactly what the 2026-08-04 verification script did: PATCH the stale text
  // through the normal edit path, with no explicit ownership claim.
  const { request: afterQa } = await editRequest(db, deal, request, {
    productDescriptionEn: STALE,
    quantity: 1,
  }, null);

  assert.equal(afterQa.productDescriptionSource, 'auto', 'no silent ownership');
  assert.equal(afterQa.productDescriptionEn, CANONICAL_26617, 'the canonical label wins over an unclaimed write');
  assert.notEqual(afterQa.productDescriptionEn, STALE);
});

test('re-saving the canonical text is not an override', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, { productDescriptionEn: CANONICAL_26617, productDescriptionOverride: true });
  assert.equal(request.productDescriptionSource, 'auto', 'identical text is not a manual choice');
});

// ── 10-11. payload parity + the one-active invariant ─────────────────────────

test('the stored/displayed text is byte-identical to the Cardcom ProductName', async () => {
  process.env.CARDCOM_TERMINAL_NUMBER = '147226';
  process.env.CARDCOM_API_NAME = 'test';
  process.env.CARDCOM_WEBHOOK_SECRET = 'whsec';
  process.env.PUBLIC_ORIGIN = 'https://app.example.com';
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, { productDescriptionEn: CANONICAL_26617 });
  const calls = [];
  await ensureCurrentCardcomLowProfile(db, request, {
    deps: {
      createLowProfile: async (p) => {
        calls.push(p);
        return { lowProfileId: 'lp1', url: 'https://pay/lp1', raw: {} };
      },
    },
  });
  assert.equal(calls[0].productName, CANONICAL_26617);
  assert.equal(calls[0].productName, db._store.get(request.id).productDescriptionEn);
});

// ── 12-13. invoice-email choice (Slice G2) ───────────────────────────────────

test('the invoice-email choice is FROZEN onto the request at create/edit', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const { request } = await create(db, deal, {
    productDescriptionEn: CANONICAL_26617,
    customerEmail: 'tourist@example.com',
    emailInvoiceToCustomer: true,
  });
  assert.equal(request.emailInvoiceToCustomer, true, 'frozen on the row — never re-read from UI state after payment');

  // Unchecking on edit updates the frozen choice (still pending).
  const { request: off } = await editRequest(db, deal, request, {
    productDescriptionEn: CANONICAL_26617,
    customerEmail: 'tourist@example.com',
    emailInvoiceToCustomer: false,
    quantity: 1,
  }, null);
  assert.equal(off.emailInvoiceToCustomer, false);
});

test('requesting the invoice email WITHOUT a customer email is refused up front', async () => {
  const db = makeDb();
  await assert.rejects(
    () => create(db, DEAL_26617(), {
      productDescriptionEn: CANONICAL_26617,
      customerEmail: '',
      emailInvoiceToCustomer: true,
    }),
    (e) => e.code === 'invoice_email_requires_customer_email',
  );
  assert.equal(db._store.size, 0, 'nothing was created — never a silent "will be sent"');
});

test('re-opening the popup on a deal that already has a link never creates a second request', async () => {
  const db = makeDb();
  const deal = DEAL_26617();
  const first = await create(db, deal, { productDescriptionEn: CANONICAL_26617 });
  const second = await create(db, deal, { productDescriptionEn: CANONICAL_26617 });
  assert.equal(second.reopened, true);
  assert.equal(second.request.id, first.request.id);
  assert.equal(db._store.size, 1, 'exactly one active request per deal');
});
