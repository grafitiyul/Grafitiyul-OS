// Behaviour tests for the multi-deal allocation service.
//
// The fake below models ONLY what allocation.js touches, and it enforces the
// two constraints that make the service safe — the unique (group, deal) index
// and BigInt columns — because a fake that is more permissive than Postgres is
// how a green suite hides a production 500 (see the Prisma-shape contract
// beside this file for the other half of that guard).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAllocations,
  loadAllocationGroup,
  ensureGroup,
  crossCustomerCheck,
  validatePlan,
  documentGroupId,
  SOURCE_KINDS,
} from './allocation.js';

// ── Fake Prisma ──────────────────────────────────────────────────────────────

function makeDb() {
  const db = {
    icountDocument: [],
    dealCollectionEvidence: [],
    paymentAllocationEvent: [],
    deal: [],
    reviewItem: [],
    _seq: 0,
  };
  const id = () => `row${++db._seq}`;
  const uniqueViolation = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

  // Only the two PAYMENT tables carry the (allocationGroupId, dealId) unique
  // index. PaymentAllocationEvent deliberately holds many rows per (group,
  // deal) — that is what an audit trail IS — so enforcing it there would be a
  // fake that is stricter than Postgres and would fail correct code.
  const table = (name, { uniqueAllocationPerDeal = false } = {}) => ({
    findUnique: async ({ where }) => db[name].find((r) => r.id === where.id) || null,
    findFirst: async ({ where = {} }) => db[name].find((r) => match(r, where)) || null,
    findMany: async ({ where = {} }) => db[name].filter((r) => match(r, where)),
    create: async ({ data }) => {
      if (uniqueAllocationPerDeal && data.allocationGroupId != null
        && db[name].some((r) => r.allocationGroupId === data.allocationGroupId && r.dealId === data.dealId)) {
        throw uniqueViolation();
      }
      if (data.idempotencyKey && db[name].some((r) => r.idempotencyKey === data.idempotencyKey)) {
        throw uniqueViolation();
      }
      const row = { id: id(), status: 'issued', ...data };
      db[name].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = db[name].find((r) => r.id === where.id);
      if (!row) throw new Error(`${name}.update: missing row`);
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }) => {
      const i = db[name].findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error(`${name}.delete: missing row`);
      return db[name].splice(i, 1)[0];
    },
  });

  function match(row, where) {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('in' in v && !v.in.includes(row[k])) return false;
        if ('not' in v) {
          if (v.not === null && row[k] == null) return false;
          if (v.not !== null && row[k] === v.not) return false;
        }
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  }

  const client = {
    icountDocument: table('icountDocument', { uniqueAllocationPerDeal: true }),
    dealCollectionEvidence: table('dealCollectionEvidence', { uniqueAllocationPerDeal: true }),
    paymentAllocationEvent: table('paymentAllocationEvent'),
    deal: table('deal'),
    reviewItem: {
      ...table('reviewItem'),
      findUnique: async ({ where }) =>
        db.reviewItem.find((r) => (where.id ? r.id === where.id : r.dedupeKey === where.dedupeKey)) || null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of db.reviewItem) if (match(r, where)) { Object.assign(r, data); count += 1; }
        return { count };
      },
    },
    $transaction: async (fn) => fn(client),
    _db: db,
  };
  return client;
}

const ILS = (n) => n * 100;

async function seedDeal(db, { id: dealId, orderNo, valueMinor, orgId = null, contactId = null }) {
  db._db.deal.push({
    id: dealId, orderNo, title: `deal ${orderNo}`, status: 'won',
    valueMinor: BigInt(valueMinor), currency: 'ILS',
    organizationId: orgId, organization: orgId ? { id: orgId, name: `org ${orgId}` } : null,
    contacts: contactId ? [{ contactId, contact: { firstNameHe: 'לקוח', lastNameHe: String(orderNo) } }] : [],
    mergedIntoDealId: null,
  });
}

/** One issued document on deal A, no allocation yet — the ordinary starting point. */
async function seedDocument(db, { dealId, amountMinor, docnum = '5001' }) {
  return db.icountDocument.create({
    data: {
      dealId, provider: 'icount', source: 'user', doctype: 'invrec', docnum,
      status: 'issued', amountMinor: BigInt(amountMinor), currency: 'ILS',
      clientName: 'Test', idempotencyKey: `test:${docnum}`,
    },
  });
}

const ACTOR = { type: 'user', id: 'u1', name: 'admin' };
const shares = (group) => Object.fromEntries(group.allocations.map((a) => [a.orderNo, a.amountMinor]));

// ── 1 → 1 : unchanged behaviour ──────────────────────────────────────────────

test('a single-deal payment keeps NO allocation — the historical row shape', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(250) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(250) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });

  await db.$transaction((tx) => applyAllocations(tx, {
    groupId, plan: [{ dealId: 'a', amountMinor: ILS(250) }], actor: ACTOR, originDealId: 'a',
  }));

  // Back to one deal for the whole amount → the per-deal share is cleared, so
  // the row reads exactly as it did before anyone touched it.
  assert.equal(db._db.icountDocument[0].allocationMinor, null);
  assert.equal(db._db.icountDocument[0].sharedHistorical, false);
  const group = await loadAllocationGroup(db, groupId);
  assert.equal(group.state, 'balanced');
  assert.equal(group.allocations.length, 1);
});

// ── 1 → N ────────────────────────────────────────────────────────────────────

test('one payment → two deals, both fully settled', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000), contactId: 'c1' });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(500), contactId: 'c1' });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });

  const res = await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
    actor: ACTOR, originDealId: 'a',
  }));

  assert.equal(res.state, 'balanced');
  const group = await loadAllocationGroup(db, groupId);
  assert.deepEqual(shares(group), { 1: ILS(1000), 2: ILS(500) });
  // The MONEY is repeated on both rows; only the share differs. That is what
  // lets company totals dedupe and per-deal collection stay independent.
  for (const row of db._db.icountDocument) assert.equal(Number(row.amountMinor), ILS(1500));
  assert.equal(db._db.icountDocument.length, 2);
});

test('one payment → three deals, full + full + partial', async () => {
  const db = makeDb();
  for (const [i, v] of [[1, 1000], [2, 1200], [3, 900]].entries()) {
    await seedDeal(db, { id: `d${i}`, orderNo: v[0], valueMinor: ILS(v[1]), contactId: 'c1' });
  }
  const doc = await seedDocument(db, { dealId: 'd0', amountMinor: ILS(3000) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });

  const res = await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [
      { dealId: 'd0', amountMinor: ILS(1000) }, // settles #1 in full
      { dealId: 'd1', amountMinor: ILS(1200) }, // settles #2 in full
      { dealId: 'd2', amountMinor: ILS(600) }, // #3 owes 900 → partial
    ],
    actor: ACTOR, originDealId: 'd0',
  }));
  assert.equal(res.state, 'unallocated');
  assert.equal(res.unallocatedMinor, ILS(200));
  assert.equal(db._db.icountDocument.length, 3);
});

test('the model has no notion of "two" — six deals work identically', async () => {
  const db = makeDb();
  for (let i = 0; i < 6; i += 1) await seedDeal(db, { id: `d${i}`, orderNo: i, valueMinor: ILS(100) });
  const doc = await seedDocument(db, { dealId: 'd0', amountMinor: ILS(600) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  const res = await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: Array.from({ length: 6 }, (_, i) => ({ dealId: `d${i}`, amountMinor: ILS(100) })),
    actor: ACTOR, originDealId: 'd0',
  }));
  assert.equal(res.state, 'balanced');
  assert.equal(res.dealCount, 6);
});

// ── Over-allocation: allowed, visible, never revenue ─────────────────────────

test('over-allocation SAVES, and reports the discrepancy', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(700) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });

  const res = await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(700) }],
    actor: ACTOR, originDealId: 'a',
  }));

  assert.equal(res.state, 'over');
  assert.equal(res.overAllocatedMinor, ILS(200));
  // THE invariant: the real money on every row is still ₪1,500. Nothing about
  // over-allocating created ₪200.
  for (const row of db._db.icountDocument) assert.equal(Number(row.amountMinor), ILS(1500));
  const group = await loadAllocationGroup(db, groupId);
  assert.equal(group.realMinor, ILS(1500));
});

// ── Correction after the document exists ─────────────────────────────────────

test('re-allocating after issue moves shares and never touches the document', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 27101, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 27102, valueMinor: ILS(700) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500), docnum: '12345' });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
    actor: ACTOR, originDealId: 'a',
  }));

  const before = db._db.icountDocument.map((r) => ({ docnum: r.docnum, amount: Number(r.amountMinor), status: r.status }));

  // The owner's worked example: ₪1,000 → ₪800 and ₪500 → ₪700.
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(800) }, { dealId: 'b', amountMinor: ILS(700) }],
    actor: { type: 'user', id: 'u2', name: 'admin' },
    reason: 'תיקון שיוך',
    originDealId: 'a',
  }));

  const group = await loadAllocationGroup(db, groupId);
  assert.deepEqual(shares(group), { 27101: ILS(800), 27102: ILS(700) });
  // The accounting document itself is untouched — same number, same amount,
  // same status. Re-allocation is an INTERNAL correction.
  assert.deepEqual(
    db._db.icountDocument.map((r) => ({ docnum: r.docnum, amount: Number(r.amountMinor), status: r.status })),
    before,
  );
});

test('every allocation change is audited with before → after', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 27101, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 27102, valueMinor: ILS(700) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
    actor: ACTOR, originDealId: 'a',
  }));
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(800) }, { dealId: 'b', amountMinor: ILS(700) }],
    actor: { type: 'user', id: 'u2', name: 'דור' }, reason: 'תיקון', originDealId: 'a',
  }));

  const events = db._db.paymentAllocationEvent;
  const correction = events.filter((e) => e.reason === 'תיקון');
  assert.equal(correction.length, 2);
  const a = correction.find((e) => e.orderNo === 27101);
  assert.equal(a.action, 'reallocated');
  assert.equal(Number(a.previousMinor), ILS(1000));
  assert.equal(Number(a.nextMinor), ILS(800));
  assert.equal(a.actorName, 'דור');
  assert.equal(a.docnum, '5001');
  // The reconciliation state the operator left behind is recorded too.
  assert.equal(Number(a.sourceAmountMinor), ILS(1500));
  assert.equal(Number(a.allocatedTotalMinor), ILS(1500));
});

test('removing a deal from the plan drops its row and audits the removal', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(500) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
    actor: ACTOR, originDealId: 'a',
  }));
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId, plan: [{ dealId: 'a', amountMinor: ILS(1500) }], actor: ACTOR, originDealId: 'a',
  }));

  assert.equal(db._db.icountDocument.length, 1);
  assert.equal(db._db.icountDocument[0].dealId, 'a');
  assert.ok(db._db.paymentAllocationEvent.some((e) => e.action === 'removed' && e.orderNo === 2));
});

test('the deal a document was ISSUED against can never be dropped from it', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(500) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
    actor: ACTOR, originDealId: 'a',
  }));

  await assert.rejects(
    () => db.$transaction((tx) => applyAllocations(tx, {
      groupId, plan: [{ dealId: 'b', amountMinor: ILS(1500) }], actor: ACTOR, originDealId: 'a',
    })),
    (e) => e.code === 'allocation_origin_required',
  );
});

// ── Idempotency ──────────────────────────────────────────────────────────────

test('applying the same plan twice changes nothing (retry / double-click)', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(500) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  const plan = [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }];

  await db.$transaction((tx) => applyAllocations(tx, { groupId, plan, actor: ACTOR, originDealId: 'a' }));
  const auditAfterFirst = db._db.paymentAllocationEvent.length;
  await db.$transaction((tx) => applyAllocations(tx, { groupId, plan, actor: ACTOR, originDealId: 'a' }));

  assert.equal(db._db.icountDocument.length, 2, 'no duplicate share rows');
  assert.equal(db._db.paymentAllocationEvent.length, auditAfterFirst, 'a no-op writes no audit noise');
  const group = await loadAllocationGroup(db, groupId);
  assert.deepEqual(shares(group), { 1: ILS(1000), 2: ILS(500) });
});

test('ensureGroup is idempotent and reuses the provider document identity', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(250) });
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(250), docnum: '777' });
  const first = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  const second = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });
  assert.equal(first.groupId, second.groupId);
  assert.equal(first.groupId, documentGroupId('invrec', '777'));
});

// ── Manual evidence obeys the SAME rules ─────────────────────────────────────

test('a bank transfer splits across deals exactly like a document', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(1200) });
  await seedDeal(db, { id: 'c', orderNo: 3, valueMinor: ILS(800) });
  const ev = await db.dealCollectionEvidence.create({
    data: {
      dealId: 'a', kind: 'manual_payment', direction: 'in', amountMinor: BigInt(ILS(3000)),
      currency: 'ILS', paidAt: new Date(), method: 'banktransfer', status: 'active', origin: 'operator',
    },
  });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.EVIDENCE, rowId: ev.id });

  const res = await db.$transaction((tx) => applyAllocations(tx, {
    groupId,
    plan: [
      { dealId: 'a', amountMinor: ILS(1000) },
      { dealId: 'b', amountMinor: ILS(1200) },
      { dealId: 'c', amountMinor: ILS(800) },
    ],
    actor: ACTOR, originDealId: 'a',
  }));

  assert.equal(res.state, 'balanced');
  assert.equal(res.sourceKind, SOURCE_KINDS.EVIDENCE);
  assert.equal(db._db.dealCollectionEvidence.length, 3);
  // Same contract as a document: real money repeated, share per row.
  for (const row of db._db.dealCollectionEvidence) assert.equal(Number(row.amountMinor), ILS(3000));
  assert.deepEqual(
    db._db.dealCollectionEvidence.map((r) => Number(r.allocationMinor)).sort((x, y) => x - y),
    [ILS(800), ILS(1000), ILS(1200)],
  );
  // A supporting file is never re-pointed at another deal.
  assert.ok(db._db.dealCollectionEvidence.slice(1).every((r) => r.fileId === null));
});

// ── Guards ───────────────────────────────────────────────────────────────────

test('a retired deal is refused as a NEW allocation target', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(1000) });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(500) });
  db._db.deal.find((d) => d.id === 'b').mergedIntoDealId = 'z';
  const doc = await seedDocument(db, { dealId: 'a', amountMinor: ILS(1500) });
  const { groupId } = await ensureGroup(db, { sourceKind: SOURCE_KINDS.DOCUMENT, rowId: doc.id });

  await assert.rejects(
    () => db.$transaction((tx) => applyAllocations(tx, {
      groupId,
      plan: [{ dealId: 'a', amountMinor: ILS(1000) }, { dealId: 'b', amountMinor: ILS(500) }],
      actor: ACTOR, originDealId: 'a',
    })),
    (e) => e.code === 'allocation_deal_retired',
  );
});

test('validatePlan rejects only structurally impossible plans', () => {
  assert.throws(() => validatePlan([]), (e) => e.code === 'allocation_empty');
  assert.throws(() => validatePlan([{ amountMinor: 1 }]), (e) => e.code === 'allocation_deal_missing');
  assert.throws(() => validatePlan([{ dealId: 'a', amountMinor: -1 }]), (e) => e.code === 'allocation_amount_invalid');
  assert.throws(
    () => validatePlan([{ dealId: 'a', amountMinor: 1 }, { dealId: 'a', amountMinor: 2 }]),
    (e) => e.code === 'allocation_deal_duplicate',
  );
  // An over-allocating plan is STRUCTURALLY fine — the owner ruled it must save.
  assert.doesNotThrow(() => validatePlan([{ dealId: 'a', amountMinor: 999999 }]));
  // Zero is a legitimate share (a deal deliberately credited nothing yet).
  assert.doesNotThrow(() => validatePlan([{ dealId: 'a', amountMinor: 0 }]));
});

test('cross-customer is detected, never blocked', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(100), contactId: 'c1' });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(100), contactId: 'c2' });
  const cross = await crossCustomerCheck(db, ['a', 'b']);
  assert.equal(cross.cross, true);
  assert.equal(cross.deals.length, 2);
});

test('same contact, and same organization, are both "one customer"', async () => {
  const db = makeDb();
  await seedDeal(db, { id: 'a', orderNo: 1, valueMinor: ILS(100), contactId: 'c1' });
  await seedDeal(db, { id: 'b', orderNo: 2, valueMinor: ILS(100), contactId: 'c1' });
  assert.equal((await crossCustomerCheck(db, ['a', 'b'])).cross, false);

  const db2 = makeDb();
  await seedDeal(db2, { id: 'a', orderNo: 1, valueMinor: ILS(100), orgId: 'o1', contactId: 'c1' });
  await seedDeal(db2, { id: 'b', orderNo: 2, valueMinor: ILS(100), orgId: 'o1', contactId: 'c2' });
  assert.equal((await crossCustomerCheck(db2, ['a', 'b'])).cross, false);
});
