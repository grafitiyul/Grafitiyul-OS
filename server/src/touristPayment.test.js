// Cardcom tourist payment — DUPLICATE-PAYMENT PROTECTION regression suite.
//
// The scenario this guards: the customer pays on Cardcom, comes back to GOS
// before the webhook lands, and refreshes. Every path that could hand them a
// second payable session is asserted closed here. Run with `npm test`.
//
// The fake db implements the CAS semantics the real code depends on
// (updateMany filtered on the CURRENT status / lowProfileId), because that IS
// the mechanism under test — a fake that ignored the where-clause would pass
// while production double-charges. Prisma FIELD names are separately pinned to
// the generated DMMF in touristPayment.prismaShape.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_STATUSES,
  PAYABLE_STATUSES,
  ensureCurrentCardcomLowProfile,
  markReturned,
  processCardcomResult,
  reconcileCardcomRequest,
  retryAfterFailure,
} from './touristPayment.js';

// ── fake db ──────────────────────────────────────────────────────────────────

function matchField(value, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond) return cond.in.includes(value);
    if ('not' in cond) return cond.not === null ? value !== null && value !== undefined : value !== cond.not;
    if ('lt' in cond) return value != null && new Date(value) < new Date(cond.lt);
  }
  if (cond === null) return value === null || value === undefined;
  return value === cond;
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((sub) => matches(row, sub));
    return matchField(row[key], cond);
  });
}

function makeDb(rows) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const timeline = [];
  const db = {
    _store: store,
    _timeline: timeline,
    paymentRequest: {
      async findUnique({ where }) {
        const row = where.id ? store.get(where.id) : [...store.values()].find((r) => r.token === where.token);
        return row ? { ...row } : null;
      },
      async findFirst({ where }) {
        const row = [...store.values()].find((r) => matches(r, where));
        return row ? { ...row } : null;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of store.values()) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      async update({ where, data }) {
        const row = store.get(where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    timelineEntry: {
      async findFirst() {
        return null;
      },
      async create({ data }) {
        const entry = { id: `t${timeline.length + 1}`, createdAt: new Date(), ...data };
        timeline.push(entry);
        return entry;
      },
      async update({ data }) {
        return data;
      },
    },
    async $transaction(fn) {
      return fn(db);
    },
    async $executeRaw() {
      return 1;
    },
  };
  return db;
}

const TOKEN = 'tok_abc123';
const baseRequest = (over = {}) => ({
  id: 'req1',
  dealId: 'deal1',
  provider: 'cardcom',
  status: 'pending',
  token: TOKEN,
  currency: 'ILS',
  amountMinor: 100000n, // ₪1,000
  quantity: 1,
  productDescriptionEn: 'Graffiti Tour',
  customerName: 'Jane Tourist',
  customerEmail: null,
  customerPhone: null,
  vatExempt: false,
  cardcomLowProfileId: null,
  cardcomPayUrl: null,
  snapshotHash: null,
  attemptNo: 1,
  attemptHistory: null,
  returnedAt: null,
  webhookAt: null,
  lastVerifyAt: null,
  failReason: null,
  verifyHold: null,
  paidAt: null,
  cardcomTransactionId: null,
  docStatus: 'none',
  ...over,
});

// Counting mint stub — stands in for the real Cardcom LowProfile/Create call.
function mintStub() {
  const calls = [];
  const fn = async (payload) => {
    calls.push(payload);
    const n = calls.length;
    return { lowProfileId: `lp${n}`, url: `https://secure.cardcom.solutions/pay/lp${n}`, raw: { ResponseCode: 0 } };
  };
  fn.calls = calls;
  return fn;
}

// A verified-approved GetLpResult for the request's own amount.
const approvedResult = (over = {}) => ({
  responseCode: 0,
  lowProfileId: 'lp1',
  returnValue: TOKEN,
  transactionId: 'tx777',
  amount: 1000,
  cardLast4: '4242',
  approved: true,
  failReason: null,
  raw: { ResponseCode: 0, TranzactionInfo: { TranzactionId: 777, Amount: 1000, CoinId: 1 } },
  ...over,
});

// Side-effect spies — WON settle / payment-completed / accounting document.
function spies() {
  const s = { won: 0, completed: 0, doc: 0 };
  return {
    s,
    deps: {
      settleWon: async () => {
        s.won += 1;
        return { alreadyWon: false };
      },
      emitCompleted: () => {
        s.completed += 1;
      },
      issueDoc: async () => {
        s.doc += 1;
      },
    },
  };
}

const env = () => {
  process.env.CARDCOM_TERMINAL_NUMBER = '147226';
  process.env.CARDCOM_API_NAME = 'test';
  process.env.CARDCOM_WEBHOOK_SECRET = 'whsec';
  process.env.PUBLIC_ORIGIN = 'https://app.example.com';
};

// ── 1-2, 13. one session per request: concurrency + refresh + back button ─────

test('two simultaneous opens create exactly ONE stored LowProfile', async () => {
  env();
  const db = makeDb([baseRequest()]);
  const req = await db.paymentRequest.findUnique({ where: { id: 'req1' } });
  const mint = mintStub();

  // Both callers read the same pre-mint row, then race the CAS.
  const [a, b] = await Promise.all([
    ensureCurrentCardcomLowProfile(db, req, { deps: { createLowProfile: mint } }),
    ensureCurrentCardcomLowProfile(db, { ...req }, { deps: { createLowProfile: mint } }),
  ]);

  const stored = db._store.get('req1');
  assert.equal(a, b, 'both customers must land on the same payment page');
  assert.equal(a, stored.cardcomPayUrl, 'the returned URL is the stored one');
  assert.equal(stored.status, 'awaiting_payment');
  // The loser's orphan session is discarded, never stored and never shown.
  assert.equal([...new Set(mint.calls.map((_, i) => `lp${i + 1}`))].includes(stored.cardcomLowProfileId), true);
});

test('refresh before paying REUSES the same LowProfile (no second mint)', async () => {
  env();
  const db = makeDb([baseRequest()]);
  const mint = mintStub();
  const first = await ensureCurrentCardcomLowProfile(db, await db.paymentRequest.findUnique({ where: { id: 'req1' } }), {
    deps: { createLowProfile: mint },
  });
  assert.equal(mint.calls.length, 1);

  // …refresh, refresh, back-button — each re-reads the row and reuses it.
  for (let i = 0; i < 3; i += 1) {
    const again = await ensureCurrentCardcomLowProfile(db, await db.paymentRequest.findUnique({ where: { id: 'req1' } }), {
      deps: { createLowProfile: mint },
    });
    assert.equal(again, first);
  }
  assert.equal(mint.calls.length, 1, 'a refresh must NEVER mint a second payable session');
});

test('Cardcom receives EXACTLY the description the operator saw in the field', async () => {
  env();
  const typed = 'Private Graffiti Workshop — Florentin (2h)';
  const db = makeDb([baseRequest({ productDescriptionEn: typed })]);
  const mint = mintStub();
  await ensureCurrentCardcomLowProfile(db, await db.paymentRequest.findUnique({ where: { id: 'req1' } }), {
    deps: { createLowProfile: mint },
  });
  assert.equal(mint.calls[0].productName, typed, 'no rewriting, no re-resolution at mint time');
  assert.equal(mint.calls[0].productName, db._store.get('req1').productDescriptionEn);
});

// ── 3-4, 8. customer return: state moves, payment page never reopens ──────────

test('customer return moves the request to payment_returned WITHOUT marking paid', async () => {
  const db = makeDb([baseRequest({ status: 'awaiting_payment', cardcomLowProfileId: 'lp1', cardcomPayUrl: 'u' })]);
  const after = await markReturned(db, await db.paymentRequest.findUnique({ where: { id: 'req1' } }));
  assert.equal(after.status, 'payment_returned');
  assert.ok(after.returnedAt, 'the return is timestamped for operator visibility');
  assert.equal(after.paidAt, null, 'the return URL is NEVER proof of payment');
  assert.equal(after.cardcomTransactionId, null);
});

test('payment_returned can never be given a payment page (no second LowProfile)', async () => {
  env();
  const db = makeDb([
    baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1', cardcomPayUrl: 'u', returnedAt: new Date() }),
  ]);
  const mint = mintStub();
  await assert.rejects(
    () => ensureCurrentCardcomLowProfile(db, db._store.get('req1'), { deps: { createLowProfile: mint } }),
    (e) => e.code === 'state_changed',
  );
  assert.equal(mint.calls.length, 0, 'no Cardcom session may be created while verification is pending');
});

test('a request that races into payment_returned mid-mint discards the orphan session', async () => {
  env();
  const db = makeDb([baseRequest()]);
  const stale = await db.paymentRequest.findUnique({ where: { id: 'req1' } });
  const mint = async (p) => {
    // The customer returned (webhook path) while Cardcom was answering us.
    await db.paymentRequest.updateMany({ where: { id: 'req1' }, data: { status: 'payment_returned' } });
    return { lowProfileId: 'lp_orphan', url: 'https://pay/orphan', raw: {} };
  };
  await assert.rejects(
    () => ensureCurrentCardcomLowProfile(db, stale, { deps: { createLowProfile: mint } }),
    (e) => e.code === 'state_changed',
  );
  assert.equal(db._store.get('req1').cardcomPayUrl, null, 'the orphan URL must never be persisted or shown');
});

// ── 5-7, 11. webhook: exactly-once, delayed, duplicated, post-reconcile ───────

test('delayed webhook marks paid exactly once and fires each effect once', async () => {
  const db = makeDb([
    baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1', returnedAt: new Date(), webhookAt: null }),
  ]);
  const { s, deps } = spies();
  const out = await processCardcomResult(
    db,
    { token: TOKEN, lowProfileId: 'lp1' },
    { deps: { ...deps, getLpResult: async () => approvedResult() } },
  );
  assert.equal(out.ok, true);
  assert.equal(out.alreadyProcessed, false);
  const row = db._store.get('req1');
  assert.equal(row.status, 'paid');
  assert.equal(row.amountMinor, 100000n, 'the VERIFIED amount is frozen');
  assert.equal(row.cardcomTransactionId, 'tx777');
  assert.ok(row.webhookAt, 'webhook arrival is stamped for operator visibility');
  assert.deepEqual(s, { won: 1, completed: 1, doc: 1 });
});

test('duplicate webhooks act exactly once (WON, document, confirmation email)', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const call = () =>
    processCardcomResult(db, { token: TOKEN, lowProfileId: 'lp1' }, { deps: { ...deps, getLpResult: async () => approvedResult() } });

  const first = await call();
  const second = await call();
  const third = await call();

  assert.equal(first.alreadyProcessed, false);
  assert.equal(second.alreadyProcessed, true);
  assert.equal(third.alreadyProcessed, true);
  assert.deepEqual(s, { won: 1, completed: 1, doc: 1 }, 'every downstream effect fires exactly once');
});

test('concurrent webhook + reconciliation converge on ONE payment', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const getLpResult = async () => approvedResult();
  await Promise.all([
    processCardcomResult(db, { token: TOKEN, lowProfileId: 'lp1' }, { deps: { ...deps, getLpResult } }),
    reconcileCardcomRequest(db, db._store.get('req1'), { force: true, deps: { ...deps, getLpResult } }),
  ]);
  assert.equal(db._store.get('req1').status, 'paid');
  assert.deepEqual(s, { won: 1, completed: 1, doc: 1 });
});

test('a webhook arriving AFTER reconciliation already paid it does nothing', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const getLpResult = async () => approvedResult();
  await reconcileCardcomRequest(db, db._store.get('req1'), { force: true, deps: { ...deps, getLpResult } });
  assert.equal(db._store.get('req1').status, 'paid');
  const late = await processCardcomResult(db, { token: TOKEN, lowProfileId: 'lp1' }, { deps: { ...deps, getLpResult } });
  assert.equal(late.alreadyProcessed, true);
  assert.deepEqual(s, { won: 1, completed: 1, doc: 1 });
});

// ── 12. verification rigour: no payment without provider proof ────────────────

test('amount mismatch is HELD for review, never auto-paid', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const out = await processCardcomResult(
    db,
    { token: TOKEN, lowProfileId: 'lp1' },
    { deps: { ...deps, getLpResult: async () => approvedResult({ amount: 250 }) } },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'verification_hold');
  const row = db._store.get('req1');
  assert.equal(row.status, 'payment_returned', 'stays unresolved — the office decides');
  assert.ok(row.verifyHold.includes('amount'));
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 }, 'no WON, no document, no confirmation email');
});

test('currency mismatch is HELD for review, never auto-paid', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const wrongCoin = approvedResult({ raw: { ResponseCode: 0, TranzactionInfo: { TranzactionId: 777, Amount: 1000, CoinId: 2 } } });
  const out = await processCardcomResult(db, { token: TOKEN, lowProfileId: 'lp1' }, { deps: { ...deps, getLpResult: async () => wrongCoin } });
  assert.equal(out.reason, 'verification_hold');
  assert.ok(db._store.get('req1').verifyHold.includes('currency'));
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 });
});

test('a result without transaction identity never marks paid', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const out = await processCardcomResult(
    db,
    { token: TOKEN, lowProfileId: 'lp1' },
    { deps: { ...deps, getLpResult: async () => approvedResult({ transactionId: null }) } },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no_transaction_identity');
  assert.equal(db._store.get('req1').status, 'payment_returned');
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 });
});

test('a foreign ReturnValue (token mismatch) is rejected outright', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { s, deps } = spies();
  const out = await processCardcomResult(
    db,
    { token: TOKEN, lowProfileId: 'lp1' },
    { deps: { ...deps, getLpResult: async () => approvedResult({ returnValue: 'someone_elses_token' }) } },
  );
  assert.equal(out.reason, 'return_value_mismatch');
  assert.equal(db._store.get('req1').status, 'payment_returned');
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 });
});

// ── 9-10. terminal states + the ONLY replacement path ────────────────────────

test('a PAID request is never payable again', async () => {
  env();
  const db = makeDb([baseRequest({ status: 'paid', paidAt: new Date(), cardcomLowProfileId: 'lp1', cardcomPayUrl: 'u' })]);
  const mint = mintStub();
  await assert.rejects(
    () => ensureCurrentCardcomLowProfile(db, db._store.get('req1'), { deps: { createLowProfile: mint } }),
    (e) => e.code === 'state_changed',
  );
  assert.equal(mint.calls.length, 0);
  // …and a late webhook cannot re-run the effects.
  const { s, deps } = spies();
  const out = await processCardcomResult(db, { token: TOKEN }, { deps: { ...deps, getLpResult: async () => approvedResult() } });
  assert.equal(out.alreadyProcessed, true);
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 });
});

test('a verified FAILED attempt is replaced only through the explicit retry path', async () => {
  env();
  const db = makeDb([baseRequest({ status: 'awaiting_payment', cardcomLowProfileId: 'lp1', cardcomPayUrl: 'https://pay/lp1' })]);
  const { s, deps } = spies();
  // Provider-verified decline → 'failed' (no money, no effects).
  await processCardcomResult(
    db,
    { token: TOKEN, lowProfileId: 'lp1' },
    { deps: { ...deps, getLpResult: async () => approvedResult({ approved: false, failReason: 'declined' }) } },
  );
  assert.equal(db._store.get('req1').status, 'failed');
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 });

  // The failed state itself is not payable…
  const mint = mintStub();
  await assert.rejects(
    () => ensureCurrentCardcomLowProfile(db, db._store.get('req1'), { deps: { createLowProfile: mint } }),
    (e) => e.code === 'state_changed',
  );
  assert.equal(mint.calls.length, 0);

  // …only the retry path reopens it, archiving the dead attempt.
  const retried = await retryAfterFailure(db, db._store.get('req1'));
  assert.equal(retried.status, 'pending');
  assert.equal(retried.attemptNo, 2);
  assert.equal(retried.cardcomLowProfileId, null);
  assert.equal(retried.attemptHistory.length, 1);
  assert.equal(retried.attemptHistory[0].lowProfileId, 'lp1', 'prior provider evidence is preserved, never rewritten');

  const fresh = await ensureCurrentCardcomLowProfile(db, retried, { deps: { createLowProfile: mint } });
  assert.equal(mint.calls.length, 1);
  assert.equal(db._store.get('req1').cardcomPayUrl, fresh);
});

test('a double-clicked retry archives the dead attempt exactly once', async () => {
  const db = makeDb([baseRequest({ status: 'failed', cardcomLowProfileId: 'lp1', failReason: 'declined' })]);
  const row = db._store.get('req1');
  await Promise.all([retryAfterFailure(db, { ...row }), retryAfterFailure(db, { ...row })]);
  const after = db._store.get('req1');
  assert.equal(after.attemptNo, 2, 'the losing click must not bump the attempt again');
  assert.equal(after.attemptHistory.length, 1);
});

test('a webhook for a CANCELED request never auto-pays — it is held for the office', async () => {
  const db = makeDb([baseRequest({ status: 'canceled' })]);
  const { s, deps } = spies();
  const out = await processCardcomResult(db, { token: TOKEN }, { deps: { ...deps, getLpResult: async () => approvedResult() } });
  assert.equal(out.reason, 'request_canceled');
  assert.equal(db._store.get('req1').status, 'canceled');
  assert.ok(db._store.get('req1').verifyHold, 'the office is alerted instead of silently losing real money');
  assert.deepEqual(s, { won: 0, completed: 0, doc: 0 });
});

// ── reconciliation guards ────────────────────────────────────────────────────

test('reconciliation is rate-limited per request (no provider stampede from polling)', async () => {
  let calls = 0;
  const db = makeDb([
    baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1', lastVerifyAt: new Date() }),
  ]);
  const getLpResult = async () => {
    calls += 1;
    return approvedResult({ approved: false, transactionId: null });
  };
  await reconcileCardcomRequest(db, db._store.get('req1'), { deps: { getLpResult } });
  await reconcileCardcomRequest(db, db._store.get('req1'), { deps: { getLpResult } });
  assert.equal(calls, 0, 'a just-verified request is not re-queried by every poll tick');
});

test('a provider outage during reconciliation leaves the request untouched (never payable)', async () => {
  const db = makeDb([baseRequest({ status: 'payment_returned', cardcomLowProfileId: 'lp1' })]);
  const { state } = await reconcileCardcomRequest(db, db._store.get('req1'), {
    force: true,
    deps: {
      getLpResult: async () => {
        throw Object.assign(new Error('cardcom_timeout'), { code: 'cardcom_timeout' });
      },
    },
  });
  assert.equal(state, 'payment_returned', 'stays in verification — never falls back to a payment page');
  assert.equal(db._store.get('req1').paidAt, null);
});

// ── state-set invariants ─────────────────────────────────────────────────────

test('the ACTIVE set is exactly the one-active-request-per-deal predicate', () => {
  // Must stay in lockstep with the partial unique index in
  // 20260803180000_cardcom_payment_state_machine/migration.sql.
  assert.deepEqual(ACTIVE_STATUSES, ['pending', 'awaiting_payment', 'payment_returned', 'failed']);
  assert.deepEqual(PAYABLE_STATUSES, ['pending', 'awaiting_payment']);
  for (const terminal of ['paid', 'canceled', 'expired']) {
    assert.equal(ACTIVE_STATUSES.includes(terminal), false, `${terminal} must be terminal`);
    assert.equal(PAYABLE_STATUSES.includes(terminal), false, `${terminal} must never be payable`);
  }
  // payment_returned is active (blocks a second request) but NOT payable.
  assert.equal(ACTIVE_STATUSES.includes('payment_returned'), true);
  assert.equal(PAYABLE_STATUSES.includes('payment_returned'), false);
});
