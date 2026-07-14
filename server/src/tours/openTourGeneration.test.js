import test from 'node:test';
import assert from 'node:assert/strict';
import { planTemplateGeneration, addExceptionRuleId } from './openTourGeneration.js';
import { israelToday, addDays, weekdayOf } from './slotGeneration.js';

// A concrete future date inside the default 6-day generation horizon + its
// weekday, so the DB-backed generation tests below stay deterministic regardless
// of the wall-clock day they run on (ensureTourSlots reads israelToday()).
const OCC_DATE = addDays(israelToday(), 2);
const OCC_WEEKDAY = weekdayOf(OCC_DATE);

// The pure open-tour date planner: recurring weekday rules bounded by a validity
// window, with one-off cancel / time_override / add exceptions layered on top.
// No DB, no product resolution — just the "which occurrences, when" contract.

const HORIZON = { today: '2026-07-09', target: '2026-09-07' }; // 60 days, Thu start

test('a weekly rule hits every matching weekday in the horizon exactly once', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }], // Thursday
    exceptions: [],
  };
  const { rows, cursorPatches } = planTemplateGeneration(tpl, HORIZON);
  assert.equal(rows.length, 9); // 9 Thursdays in a 60-day window
  assert.ok(rows.every((r) => r.startTime === '17:00'));
  assert.ok(rows.every((r) => r.generatedByRuleId === 'r1'));
  assert.equal(rows[0].date, '2026-07-09');
  assert.deepEqual(cursorPatches, [{ id: 'r1', generatedThrough: '2026-09-07' }]);
});

test('validFrom / validUntil clamp the generated range', () => {
  const tpl = {
    scheduleRules: [
      { id: 'r1', weekday: 4, startTime: '10:00', validFrom: '2026-07-20', validUntil: '2026-08-10' },
    ],
    exceptions: [],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  // Thursdays in [2026-07-20, 2026-08-10]: 23/7, 30/7, 6/8 → 3
  assert.deepEqual(rows.map((r) => r.date), ['2026-07-23', '2026-07-30', '2026-08-06']);
});

test('the generatedThrough cursor is respected (only dates beyond it)', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00', generatedThrough: '2026-08-15' }],
    exceptions: [],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  // First Thursday strictly after 2026-08-15 is 2026-08-20.
  assert.deepEqual(rows.map((r) => r.date), ['2026-08-20', '2026-08-27', '2026-09-03']);
});

test('a cancel exception suppresses exactly that occurrence', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }],
    exceptions: [{ id: 'e1', date: '2026-07-16', type: 'cancel' }],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  assert.equal(rows.length, 8);
  assert.ok(!rows.some((r) => r.date === '2026-07-16'));
});

test('a time_override exception changes only that occurrence time', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }],
    exceptions: [{ id: 'e1', date: '2026-07-23', type: 'time_override', time: '20:30' }],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  const overridden = rows.find((r) => r.date === '2026-07-23');
  assert.equal(overridden.startTime, '20:30');
  assert.ok(rows.filter((r) => r.date !== '2026-07-23').every((r) => r.startTime === '17:00'));
});

test('an add exception injects an extra occurrence on a non-rule day', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }],
    exceptions: [{ id: 'e1', date: '2026-07-14', type: 'add', time: '11:00' }], // a Tuesday
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  const extra = rows.find((r) => r.date === '2026-07-14');
  assert.ok(extra);
  assert.equal(extra.startTime, '11:00');
  assert.equal(extra.generatedByRuleId, addExceptionRuleId('e1'));
});

test('add exceptions are ignored when in the past, timeless, or also cancelled', () => {
  const tpl = {
    scheduleRules: [],
    exceptions: [
      { id: 'past', date: '2026-07-01', type: 'add', time: '11:00' }, // before today
      { id: 'notime', date: '2026-07-20', type: 'add' }, // no time
      { id: 'both1', date: '2026-07-21', type: 'add', time: '11:00' },
      { id: 'both2', date: '2026-07-21', type: 'cancel' }, // contradicts the add
    ],
    products: [],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  assert.equal(rows.length, 0);
});

// ── Regression: ONLY the Open Tours engine generates (legacy retired) ─────────
// A fake client whose legacy `tourScheduleRule` model throws on ANY access —
// proving ensureTourSlots never touches the retired path — and that one weekly
// schedule occurrence materializes EXACTLY one TourEvent.

// A stateful in-memory TourEvent store that honours the canonical identity
// (openTourTemplateId, date, startTime) — createMany skipDuplicates rejects a
// second ACTIVE row for the same identity (the partial unique index), matching
// how ensureCanonicalSlot relies on the DB. seededRows preload existing slots.
function genClient({ template, generateDaysAhead = 6, seededRows = [] } = {}) {
  const rows = seededRows.map((r, i) => ({ id: r.id || `seed${i}`, kind: 'group_slot', status: 'scheduled', ...r }));
  let seq = 0;
  const created = [];
  const isActive = (s) => s.status === 'scheduled' || s.status === 'completed';
  const identityActiveExists = (r) =>
    rows.some(
      (x) =>
        x.kind === 'group_slot' &&
        isActive(x) &&
        x.openTourTemplateId === r.openTourTemplateId &&
        x.date === r.date &&
        x.startTime === r.startTime,
    );
  const matchWhere = (x, w) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === 'status' && v && typeof v === 'object' && v.in) { if (!v.in.includes(x.status)) return false; continue; }
      if (k === 'date' && v && typeof v === 'object' && v.gte) { if (!(x.date >= v.gte)) return false; continue; }
      if (x[k] !== v) return false;
    }
    return true;
  };
  return {
    _rows: rows,
    _created: created,
    tourScheduleRule: new Proxy(
      {},
      { get() { throw new Error('LEGACY tourScheduleRule accessed — legacy path not retired'); } },
    ),
    openTourTemplate: {
      findMany: async () => (template ? [template] : []),
      findUnique: async () => template || null,
    },
    tourSettings: { upsert: async () => ({ defaultCapacity: 30, generateDaysAhead }) },
    tourEvent: {
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const r of data) {
          if (skipDuplicates && r.status === 'scheduled' && identityActiveExists(r)) continue; // partial unique index
          const row = { id: `new${seq++}`, ...r };
          rows.push(row);
          created.push(row);
          count += 1;
        }
        return { count };
      },
      findMany: async ({ where = {} }) => rows.filter((x) => matchWhere(x, where)).map((x) => ({ ...x, _count: { wooVariationLinks: 0, ticketRegistrations: 0, bookings: 0 } })),
      findFirst: async ({ where = {}, orderBy }) => {
        let hits = rows.filter((x) => matchWhere(x, where));
        if (orderBy?.createdAt === 'desc') hits = hits.reverse();
        return hits[0] ? { ...hits[0] } : null;
      },
      count: async ({ where = {} }) => rows.filter((x) => matchWhere(x, where)).length,
      update: async ({ where, data }) => {
        const row = rows.find((x) => x.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    openTourScheduleRule: { update: async () => ({}) },
    productVariantActivityComponent: { findMany: async () => [] },
    tourEventActivityComponent: { createMany: async () => ({ count: 0 }) },
  };
}

test('ensureTourSlots delegates ONLY to the Open Tours engine (legacy never invoked)', async () => {
  const { ensureTourSlots } = await import('./openTourGeneration.js');
  const client = genClient({ template: null }); // no templates → nothing to do
  const n = await ensureTourSlots(client); // must NOT touch the legacy trap
  assert.equal(n, 0);
});

test('one weekly schedule occurrence materializes EXACTLY one TourEvent', async () => {
  const { ensureTourSlots } = await import('./openTourGeneration.js');
  const template = {
    id: 'tpl1',
    tourLanguage: 'he',
    capacity: null,
    locationId: null,
    products: [],
    exceptions: [],
    // A single weekly rule; a 7-day horizon (gen=6) contains each weekday once.
    scheduleRules: [{ id: 'r1', weekday: 3, startTime: '17:00' }],
  };
  const client = genClient({ template, generateDaysAhead: 6 });
  await ensureTourSlots(client);
  assert.equal(client._created.length, 1, 'exactly one TourEvent per occurrence');
  assert.equal(client._created[0].kind, 'group_slot');
  assert.equal(client._created[0].generatedByRuleId, 'r1');
});

// ── Canonical identity: no duplicate active occurrences ──────────────────────

const weeklyTpl = (rules) => ({
  id: 'tpl1', tourLanguage: 'he', capacity: null, locationId: null, products: [], exceptions: [], scheduleRules: rules,
});

test('running generation TWICE creates the occurrence once (idempotent)', async () => {
  const template = weeklyTpl([{ id: 'r1', weekday: OCC_WEEKDAY, startTime: '17:00' }]);
  const client = genClient({ template, generateDaysAhead: 6 });
  const { ensureTourSlots } = await import('./openTourGeneration.js');
  const a = await ensureTourSlots(client);
  const b = await ensureTourSlots(client);
  assert.ok(a >= 1);
  assert.equal(b, 0, 'second run creates nothing — the slot already exists');
  assert.equal(client._rows.filter((r) => r.status === 'scheduled' && r.date === OCC_DATE).length, 1);
});

test('rule delete+recreate: a NEW rule id does NOT duplicate the live slot (re-attributed)', async () => {
  // A scheduled slot generated by the now-DELETED rule 'dead' already exists.
  const template = weeklyTpl([{ id: 'newRule', weekday: OCC_WEEKDAY, startTime: '17:00' }]);
  const existing = { id: 'live', openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '17:00', status: 'scheduled', generatedByRuleId: 'dead' };
  const client = genClient({ template, generateDaysAhead: 6, seededRows: [existing] });
  const { ensureTourSlots } = await import('./openTourGeneration.js');
  const created = await ensureTourSlots(client);
  assert.equal(created, 0, 'no new row — the live slot is reused');
  const rows = client._rows.filter((r) => r.status === 'scheduled' && r.date === OCC_DATE);
  assert.equal(rows.length, 1, 'still exactly one active occurrence');
  assert.equal(rows[0].id, 'live');
  assert.equal(rows[0].generatedByRuleId, 'newRule', 're-attributed to the current rule (visible to ruleEdit)');
});

test('a cancelled occurrence is REOPENED, not re-created, when the rule requires it again', async () => {
  const template = weeklyTpl([{ id: 'r1', weekday: OCC_WEEKDAY, startTime: '17:00' }]);
  const cancelled = { id: 'old', openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '17:00', status: 'cancelled', generatedByRuleId: 'r1', createdAt: '2026-07-13' };
  const client = genClient({ template, generateDaysAhead: 6, seededRows: [cancelled] });
  const { ensureTourSlots } = await import('./openTourGeneration.js');
  const created = await ensureTourSlots(client);
  assert.equal(created, 0, 'no fresh row created');
  const active = client._rows.filter((r) => r.status === 'scheduled' && r.date === OCC_DATE);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'old', 'the SAME row was reopened — history preserved');
});

test('the partial unique index rejects a second active row for the same identity', async () => {
  const template = weeklyTpl([{ id: 'r1', weekday: OCC_WEEKDAY, startTime: '17:00' }]);
  const client = genClient({ template, generateDaysAhead: 6 });
  // Two racing createMany of the SAME identity → the index lets only one through.
  const row = { openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '17:00', status: 'scheduled', kind: 'group_slot' };
  const r1 = await client.tourEvent.createMany({ data: [row], skipDuplicates: true });
  const r2 = await client.tourEvent.createMany({ data: [{ ...row }], skipDuplicates: true });
  assert.equal(r1.count, 1);
  assert.equal(r2.count, 0, 'duplicate active identity rejected');
});

test('two rules at DIFFERENT times on the same date both materialize (not blocked)', async () => {
  const template = weeklyTpl([
    { id: 'rEve', weekday: OCC_WEEKDAY, startTime: '18:00' },
    { id: 'rMorn', weekday: OCC_WEEKDAY, startTime: '10:00' },
  ]);
  const client = genClient({ template, generateDaysAhead: 6 });
  const { ensureTourSlots } = await import('./openTourGeneration.js');
  await ensureTourSlots(client);
  const active = client._rows.filter((r) => r.status === 'scheduled' && r.date === OCC_DATE);
  assert.equal(active.length, 2, 'same date, different clock times = two independent occurrences');
});

// ── reconcileExceptionDeletion — the missing reopen-on-delete path ───────────

test('deleting a cancel exception REOPENS the cancelled occurrence (the 16/07 fix)', async () => {
  const { reconcileExceptionDeletion } = await import('./openTourGeneration.js');
  const template = { ...weeklyTpl([{ id: 'thu', weekday: OCC_WEEKDAY, startTime: '18:00' }]), active: true };
  // The cancelled twin that was hidden by the (now-deleted) cancel exception.
  const cancelledRow = { id: 'cx', openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'thu' };
  const client = genClient({ template, seededRows: [cancelledRow] });
  const res = await reconcileExceptionDeletion(client, 'tpl1', { id: 'e1', type: 'cancel', date: OCC_DATE, templateId: 'tpl1' }, { log: { log() {}, warn() {} } });
  assert.equal(res.outcome, 'reopened');
  const active = client._rows.filter((r) => r.status === 'scheduled' && r.date === OCC_DATE);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'cx', 'the SAME cancelled row was revived — Woo/registration history intact');
});

test('deleting a cancel exception does NOT double-book a date already served (17/07-style)', async () => {
  const { reconcileExceptionDeletion } = await import('./openTourGeneration.js');
  const template = { ...weeklyTpl([{ id: 'thu', weekday: OCC_WEEKDAY, startTime: '18:00' }]), active: true };
  const manualReplacement = { id: 'manual', openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '13:00', status: 'scheduled', generatedByRuleId: null };
  const oldCancelled = { id: 'old', openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'thu' };
  const client = genClient({ template, seededRows: [manualReplacement, oldCancelled] });
  const res = await reconcileExceptionDeletion(client, 'tpl1', { id: 'e1', type: 'cancel', date: OCC_DATE, templateId: 'tpl1' }, { log: { log() {}, warn() {} } });
  assert.equal(res.outcome, 'already_served');
  const active = client._rows.filter((r) => r.status === 'scheduled' && r.date === OCC_DATE);
  assert.equal(active.length, 1, 'still only the replacement — the old time is NOT reopened');
  assert.equal(active[0].id, 'manual');
});

test('deleting an ADD exception cancels its empty one-off occurrence', async () => {
  const { reconcileExceptionDeletion } = await import('./openTourGeneration.js');
  const template = { ...weeklyTpl([]), active: true };
  const addSlot = { id: 'addrow', openTourTemplateId: 'tpl1', date: OCC_DATE, startTime: '11:00', status: 'scheduled', generatedByRuleId: addExceptionRuleId('e1') };
  const client = genClient({ template, seededRows: [addSlot] });
  const res = await reconcileExceptionDeletion(client, 'tpl1', { id: 'e1', type: 'add', date: OCC_DATE, templateId: 'tpl1' }, { log: { log() {}, warn() {} } });
  assert.equal(res.outcome, 'add_removed');
  assert.equal(res.cancelled, 1);
  assert.equal(client._rows.find((r) => r.id === 'addrow').status, 'cancelled');
});
