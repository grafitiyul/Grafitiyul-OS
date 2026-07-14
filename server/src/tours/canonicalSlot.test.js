import test from 'node:test';
import assert from 'node:assert/strict';
import { owningRuleId, requiredSlotsForDate, ensureCanonicalSlot } from './canonicalSlot.js';

// Pure identity helpers + the ensureCanonicalSlot decision tree over an in-memory
// store that models the partial unique index (one active row per identity).

// 2026-07-16 is a Thursday (weekday 4), 2026-07-17 a Friday (5).
const THU = '2026-07-16';
const FRI = '2026-07-17';
const RULES = [
  { id: 'thu', weekday: 4, startTime: '18:00' },
  { id: 'fri', weekday: 5, startTime: '10:00', validFrom: '2026-06-01', validUntil: '2026-10-31' },
];

test('owningRuleId matches weekday + effective time within validity', () => {
  assert.equal(owningRuleId(THU, '18:00', RULES), 'thu');
  assert.equal(owningRuleId(FRI, '10:00', RULES), 'fri');
  assert.equal(owningRuleId(THU, '13:00', RULES), null); // no rule at that time (manual)
  assert.equal(owningRuleId(FRI, '10:00', RULES, new Map([[FRI, '10:45']])), null); // overridden away from 10:00
  assert.equal(owningRuleId(FRI, '10:45', RULES, new Map([[FRI, '10:45']])), 'fri'); // overridden time owns it
});

test('owningRuleId respects validity windows and returns null when ambiguous', () => {
  assert.equal(owningRuleId('2026-05-01', '10:00', RULES), null); // before fri validFrom
  const ambiguous = [
    { id: 'a', weekday: 4, startTime: '18:00' },
    { id: 'b', weekday: 4, startTime: '18:00' },
  ];
  assert.equal(owningRuleId(THU, '18:00', ambiguous), null); // two rules → leave as-is
});

test('requiredSlotsForDate returns one row per rule covering the date', () => {
  assert.deepEqual(requiredSlotsForDate(RULES, THU), [{ date: THU, startTime: '18:00', generatedByRuleId: 'thu' }]);
  assert.deepEqual(requiredSlotsForDate(RULES, FRI, new Map([[FRI, '10:45']])), [
    { date: FRI, startTime: '10:45', generatedByRuleId: 'fri' },
  ]);
  assert.deepEqual(requiredSlotsForDate(RULES, '2026-07-15'), []); // Wednesday: no rule
});

// ── ensureCanonicalSlot over a minimal store ─────────────────────────────────

function store(seed = []) {
  const rows = seed.map((r, i) => ({ id: r.id || `s${i}`, kind: 'group_slot', ...r }));
  let seq = 0;
  const active = (x) => x.status === 'scheduled' || x.status === 'completed';
  const match = (x, w) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === 'status' && v?.in) { if (!v.in.includes(x.status)) return false; continue; }
      if (x[k] !== v) return false;
    }
    return true;
  };
  return {
    _rows: rows,
    tourEvent: {
      findFirst: async ({ where, orderBy }) => {
        let hits = rows.filter((x) => match(x, where));
        if (orderBy?.createdAt === 'desc') hits = hits.reverse();
        return hits[0] ? { ...hits[0] } : null;
      },
      findMany: async ({ where }) => rows.filter((x) => match(x, where)).map((x) => ({ ...x, _count: { wooVariationLinks: x.links || 0 } })),
      update: async ({ where, data }) => { const r = rows.find((x) => x.id === where.id); if (r) Object.assign(r, data); return r; },
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const r of data) {
          if (skipDuplicates && r.status === 'scheduled' && rows.some((x) => active(x) && x.kind === 'group_slot' && x.openTourTemplateId === r.openTourTemplateId && x.date === r.date && x.startTime === r.startTime)) continue;
          rows.push({ id: `n${seq++}`, ...r });
          count += 1;
        }
        return { count };
      },
    },
  };
}

const spec = { openTourTemplateId: 'tpl1', date: THU, startTime: '18:00', generatedByRuleId: 'thu' };

test('ensureCanonicalSlot: creates when nothing exists', async () => {
  const db = store();
  const r = await ensureCanonicalSlot(db, spec);
  assert.equal(r.outcome, 'created');
  assert.equal(db._rows.filter((x) => x.status === 'scheduled').length, 1);
});

test('ensureCanonicalSlot: existing active with a stale rule id is re-attributed, not duplicated', async () => {
  const db = store([{ id: 'live', openTourTemplateId: 'tpl1', date: THU, startTime: '18:00', status: 'scheduled', generatedByRuleId: 'DEAD' }]);
  const r = await ensureCanonicalSlot(db, spec);
  assert.equal(r.outcome, 'reattributed');
  assert.equal(r.id, 'live');
  assert.equal(db._rows.find((x) => x.id === 'live').generatedByRuleId, 'thu');
  assert.equal(db._rows.length, 1);
});

test('ensureCanonicalSlot: reopens a cancelled twin, preferring the target-rule row', async () => {
  const db = store([
    { id: 'deadTwin', openTourTemplateId: 'tpl1', date: THU, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'DEAD', links: 4, createdAt: '2026-07-13T08:15Z' },
    { id: 'ownTwin', openTourTemplateId: 'tpl1', date: THU, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'thu', links: 4, createdAt: '2026-07-13T08:16Z' },
  ]);
  const r = await ensureCanonicalSlot(db, spec);
  assert.equal(r.outcome, 'reopened');
  assert.equal(r.id, 'ownTwin', 'prefers the row already owned by the target rule');
  assert.equal(db._rows.find((x) => x.id === 'ownTwin').status, 'scheduled');
  assert.equal(db._rows.find((x) => x.id === 'deadTwin').status, 'cancelled', 'the redundant twin stays cancelled');
});

test('ensureCanonicalSlot: an existing active row wins over any cancelled twin', async () => {
  const db = store([
    { id: 'live', openTourTemplateId: 'tpl1', date: THU, startTime: '18:00', status: 'scheduled', generatedByRuleId: 'thu' },
    { id: 'twin', openTourTemplateId: 'tpl1', date: THU, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'thu' },
  ]);
  const r = await ensureCanonicalSlot(db, spec);
  assert.equal(r.outcome, 'exists');
  assert.equal(r.id, 'live');
});
