import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionDealToWon, resolveFinalStage, wonTransitionKey } from './wonTransition.js';

// The canonical WON transition core: atomic race guard, final-stage move,
// lifecycle stamping, and the immutable per-transition identity Report #26
// keys on.

function makeTx({
  deal,
  stages = [{ id: 'st_final', key: 'closing', label: 'סגירה', sortOrder: 4, isActive: true }],
  users = { u1: { id: 'u1', displayName: 'דור קורן', username: 'dorko' } },
} = {}) {
  const s = { deal: { ...deal }, updates: [] };
  return {
    _s: s,
    adminUser: { findUnique: async ({ where }) => users[where.id] || null },
    deal: {
      findUnique: async () => ({ ...s.deal }),
      updateMany: async ({ where, data }) => {
        if (where.status?.not !== undefined && s.deal.status === where.status.not) return { count: 0 };
        Object.assign(s.deal, data);
        s.updates.push(data);
        return { count: 1 };
      },
    },
    dealStage: {
      findFirst: async ({ where, orderBy }) => {
        assert.equal(where.isActive, true, 'only ACTIVE stages are eligible');
        assert.deepEqual(orderBy, [{ sortOrder: 'desc' }, { label: 'desc' }], 'canonical order, reversed');
        const active = stages.filter((x) => x.isActive);
        active.sort((a, b) => b.sortOrder - a.sortOrder || String(b.label).localeCompare(String(a.label)));
        return active[0] || null;
      },
    },
    quoteOffer: { findFirst: async () => null },
    quoteDocument: { findFirst: async () => null },
  };
}

test('a genuine transition: status, FINAL stage, wonAt and lost-field clearing in ONE write', async () => {
  const tx = makeTx({
    deal: {
      id: 'd1', status: 'lost', dealStageId: 'st_lead',
      lostAt: new Date('2026-01-01'), lostReasonId: 'lr1', lostNotes: 'x', lostReason: 'y', wonAt: null,
    },
  });
  const t = await transitionDealToWon(tx, { dealId: 'd1' });
  assert.equal(t.wonNow, true);
  assert.equal(tx._s.deal.status, 'won');
  assert.equal(tx._s.deal.dealStageId, 'st_final');
  assert.ok(tx._s.deal.wonAt instanceof Date);
  assert.equal(tx._s.deal.lostAt, null);
  assert.equal(tx._s.deal.lostReasonId, null);
  assert.equal(tx._s.deal.lostNotes, null);
  assert.equal(tx._s.deal.lostReason, null);
  // Everything landed in ONE atomic conditional write — no second update.
  assert.equal(tx._s.updates.length, 1);
  // `before` preserves the pre-transition state for the caller's changelog.
  assert.equal(t.before.status, 'lost');
  assert.equal(t.before.dealStageId, 'st_lead');
});

test('an operator-driven transition FREEZES the closer into wonActor — id, names, cause', async () => {
  const tx = makeTx({ deal: { id: 'd1', status: 'open', dealStageId: 'st_lead' } });
  const t = await transitionDealToWon(tx, { dealId: 'd1', actorUserId: 'u1', cause: 'manual' });
  assert.equal(t.wonNow, true);
  const actor = tx._s.deal.wonActor;
  assert.equal(actor.type, 'user');
  assert.equal(actor.userId, 'u1');
  assert.equal(actor.displayName, 'דור קורן');
  assert.equal(actor.username, 'dorko');
  assert.equal(actor.cause, 'manual');
  assert.equal(actor.at, tx._s.deal.wonAt.toISOString(), 'frozen at the transition moment');
  // Frozen in the SAME atomic write as status/wonAt — no second update.
  assert.equal(tx._s.updates.length, 1);
});

test('an automatic transition freezes an explicit SYSTEM actor with its cause — never a fabricated human', async () => {
  const tx = makeTx({ deal: { id: 'd1', status: 'open', dealStageId: 'st_lead' } });
  await transitionDealToWon(tx, { dealId: 'd1', cause: 'icount_payment' });
  assert.deepEqual(
    { type: tx._s.deal.wonActor.type, cause: tx._s.deal.wonActor.cause },
    { type: 'system', cause: 'icount_payment' },
  );
});

test('an unknown actorUserId degrades to a system actor rather than freezing a broken user ref', async () => {
  const tx = makeTx({ deal: { id: 'd1', status: 'open', dealStageId: 'st_lead' } });
  await transitionDealToWon(tx, { dealId: 'd1', actorUserId: 'ghost', cause: 'manual' });
  assert.equal(tx._s.deal.wonActor.type, 'system');
});

test('idempotent: an already-WON deal is a no-op with alreadyWon', async () => {
  const tx = makeTx({ deal: { id: 'd1', status: 'won', dealStageId: 'st_x' } });
  const t = await transitionDealToWon(tx, { dealId: 'd1' });
  assert.equal(t.wonNow, false);
  assert.equal(t.alreadyWon, true);
  assert.equal(tx._s.updates.length, 0, 'nothing written');
  assert.equal(tx._s.deal.dealStageId, 'st_x', 'the stage of an already-WON deal is never touched');
});

test('the RACE: a concurrent winner between read and write → count 0 → alreadyWon, no duplicate', async () => {
  const tx = makeTx({ deal: { id: 'd1', status: 'open', dealStageId: 'st_lead' } });
  // Simulate the other transaction committing between our findUnique and updateMany.
  const origFind = tx.deal.findUnique;
  tx.deal.findUnique = async () => {
    const snapshot = await origFind();
    tx._s.deal.status = 'won'; // the concurrent winner lands NOW
    return snapshot; // we still saw 'open'
  };
  const t = await transitionDealToWon(tx, { dealId: 'd1' });
  assert.equal(t.wonNow, false);
  assert.equal(t.alreadyWon, true);
  assert.equal(tx._s.updates.length, 0);
});

test('no active final stage → the transition STOPS with a coded error, nothing half-written', async () => {
  const tx = makeTx({
    deal: { id: 'd1', status: 'open', dealStageId: 'st_lead' },
    stages: [{ id: 'st_a', label: 'א', sortOrder: 0, isActive: false }],
  });
  await assert.rejects(() => transitionDealToWon(tx, { dealId: 'd1' }), (e) => e.code === 'no_final_stage');
  assert.equal(tx._s.deal.status, 'open', 'the deal is untouched');
  assert.equal(tx._s.updates.length, 0);
});

test('resolveFinalStage picks the LAST active stage by canonical order, skipping archived', async () => {
  const tx = makeTx({
    deal: { id: 'd1', status: 'open' },
    stages: [
      { id: 'st_lead', label: 'ליד', sortOrder: 0, isActive: true },
      { id: 'st_close', label: 'סגירה', sortOrder: 4, isActive: true },
      { id: 'st_zombie', label: 'ארכיון', sortOrder: 9, isActive: false },
    ],
  });
  const stage = await resolveFinalStage(tx);
  assert.equal(stage.id, 'st_close');
});

test('wonTransitionKey: one immutable identity per transition — a re-win after reopen gets a NEW key', () => {
  const t1 = wonTransitionKey('d1', new Date('2026-08-01T10:00:00Z'));
  const t2 = wonTransitionKey('d1', new Date('2026-08-02T09:00:00Z'));
  assert.notEqual(t1, t2);
  // Retries of the SAME transition resolve to the same key.
  assert.equal(t1, wonTransitionKey('d1', new Date('2026-08-01T10:00:00Z')));
});

test('deal_not_found is a coded error', async () => {
  const tx = makeTx({ deal: { id: 'other', status: 'open' } });
  tx.deal.findUnique = async () => null;
  await assert.rejects(() => transitionDealToWon(tx, { dealId: 'nope' }), (e) => e.code === 'deal_not_found');
});
