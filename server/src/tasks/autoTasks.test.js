import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureInitialCallTask, runMissingTaskSweep, FOLLOW_UP_TITLE } from './autoTasks.js';

// Fake-db harness covering exactly the prisma surface autoTasks touches.
// `legacyTaskIds` are Task ids carrying a LegacyRecord crosswalk row — i.e.
// tasks imported from Pipedrive, matching the real entityType:'Task' marker.
function makeDb({ deals = [], tasks = [], types, admins, legacyTaskIds = [] } = {}) {
  const s = {
    deals: [...deals],
    tasks: [...tasks],
    legacy: legacyTaskIds.map((id) => ({ entityType: 'Task', entityId: id })),
    types: types || [
      { id: 'tt_first', key: 'first_call', nameHe: 'שיחה ראשונית', isActive: true },
      { id: 'tt_follow', key: 'follow_up', nameHe: 'פולואפ', isActive: true },
    ],
    admins: admins || [{ id: 'admin1', isActive: true, createdAt: new Date('2026-01-01') }],
    seq: 0,
  };
  const db = {
    _s: s,
    deal: {
      findUnique: async ({ where }) => s.deals.find((d) => d.id === where.id) || null,
      findMany: async ({ where }) => s.deals.filter((d) => (where?.status ? d.status === where.status : true)),
    },
    taskType: {
      findFirst: async ({ where }) => s.types.find((t) => t.key === where.key && t.isActive === where.isActive) || null,
    },
    adminUser: {
      findUnique: async ({ where }) => s.admins.find((a) => a.id === where.id) || null,
      findFirst: async ({ where }) => s.admins.filter((a) => a.isActive === where.isActive)[0] || null,
    },
    task: {
      findFirst: async ({ where }) =>
        s.tasks.find(
          (t) =>
            t.dealId === where.dealId &&
            (where.taskTypeId === undefined || t.taskTypeId === where.taskTypeId) &&
            (where.dueDate === undefined || +t.dueDate === +where.dueDate),
        ) || null,
      findMany: async ({ where }) =>
        s.tasks.filter((t) => {
          if (where.dealId?.in && !where.dealId.in.includes(t.dealId)) return false;
          if (where.status !== undefined && t.status !== where.status) return false;
          if (where.taskTypeId !== undefined && t.taskTypeId !== where.taskTypeId) return false;
          if (where.dueDate !== undefined && +t.dueDate !== +where.dueDate) return false;
          return true;
        }),
      create: async ({ data }) => {
        const row = { id: `task${++s.seq}`, ...data };
        s.tasks.push(row);
        return row;
      },
    },
    legacyRecord: {
      findMany: async ({ where }) =>
        s.legacy.filter((r) => r.entityType === where.entityType && where.entityId.in.includes(r.entityId)),
    },
  };
  return db;
}

const openDeal = (id, over = {}) => ({ id, orderNo: 27000, status: 'open', ownerUserId: null, createdAt: new Date('2026-08-03T18:30:00Z'), ...over });

test('initial-call task: created once, date-only due on the deal creation date (Israel)', async () => {
  const db = makeDb({ deals: [openDeal('d1')] });
  const a = await ensureInitialCallTask({ dealId: 'd1' }, { db, log: { warn() {} } });
  assert.equal(a.created, true);
  const t = db._s.tasks[0];
  assert.equal(t.taskTypeId, 'tt_first');
  assert.equal(t.title, 'שיחה ראשונית');
  // 2026-08-03T18:30Z is 21:30 in Israel → due date 2026-08-03, UTC-midnight anchor, no time.
  assert.equal(t.dueDate.toISOString(), '2026-08-03T00:00:00.000Z');
  assert.equal(t.dueTime, null);
  assert.equal(t.ownerUserId, 'admin1');
  // Idempotent: a second call (retry, double hook) creates nothing.
  const b = await ensureInitialCallTask({ dealId: 'd1' }, { db, log: { warn() {} } });
  assert.equal(b.skipped, 'already_has_initial_task');
  assert.equal(db._s.tasks.length, 1);
});

test('initial-call task: skipped for non-open deals and missing deals', async () => {
  const db = makeDb({ deals: [openDeal('won1', { status: 'won' })] });
  assert.equal((await ensureInitialCallTask({ dealId: 'won1' }, { db })).skipped, 'not_open');
  assert.equal((await ensureInitialCallTask({ dealId: 'gone' }, { db })).skipped, 'deal_not_found');
  assert.equal(db._s.tasks.length, 0);
});

test('midnight sweep: open deal with NO open task gets one follow-up for the day', async () => {
  const db = makeDb({
    deals: [openDeal('d1'), openDeal('d2', { orderNo: 27001 })],
    tasks: [{ id: 't1', dealId: 'd2', taskTypeId: 'tt_first', status: 'open', dueDate: new Date('2026-08-01T00:00:00Z') }],
  });
  const out = await runMissingTaskSweep({ dateStr: '2026-08-05', db, log: { warn() {}, log() {} } });
  assert.equal(out.created, 1);
  const created = db._s.tasks.find((t) => t.dealId === 'd1');
  assert.equal(created.title, FOLLOW_UP_TITLE);
  assert.equal(created.taskTypeId, 'tt_follow');
  assert.equal(created.dueDate.toISOString(), '2026-08-05T00:00:00.000Z');
  assert.equal(created.dueTime, null);
  // d2 has an active task → untouched.
  assert.equal(db._s.tasks.filter((t) => t.dealId === 'd2').length, 1);
});

test('midnight sweep: rerun the same day creates nothing (idempotent)', async () => {
  const db = makeDb({ deals: [openDeal('d1')] });
  const first = await runMissingTaskSweep({ dateStr: '2026-08-05', db, log: { warn() {}, log() {} } });
  const second = await runMissingTaskSweep({ dateStr: '2026-08-05', db, log: { warn() {}, log() {} } });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(db._s.tasks.length, 1);
});

test('midnight sweep: a COMPLETED recovery task still blocks a second one that day', async () => {
  const db = makeDb({ deals: [openDeal('d1')] });
  await runMissingTaskSweep({ dateStr: '2026-08-05', db, log: { warn() {}, log() {} } });
  db._s.tasks[0].status = 'completed'; // operator finished it — no longer active
  const again = await runMissingTaskSweep({ dateStr: '2026-08-05', db, log: { warn() {}, log() {} } });
  assert.equal(again.created, 0, 'one recovery task per deal per day');
  // …but the NEXT day it gets a fresh one (still no active task).
  const nextDay = await runMissingTaskSweep({ dateStr: '2026-08-06', db, log: { warn() {}, log() {} } });
  assert.equal(nextDay.created, 1);
});

test('midnight sweep: completed/cancelled tasks do not count as active', async () => {
  const db = makeDb({
    deals: [openDeal('d1')],
    tasks: [
      { id: 't1', dealId: 'd1', taskTypeId: 'tt_first', status: 'completed', dueDate: new Date('2026-08-01T00:00:00Z') },
      { id: 't2', dealId: 'd1', taskTypeId: 'tt_follow', status: 'cancelled', dueDate: new Date('2026-08-02T00:00:00Z') },
    ],
  });
  const out = await runMissingTaskSweep({ dateStr: '2026-08-05', db, log: { warn() {}, log() {} } });
  assert.equal(out.created, 1);
});

// ── excludeLegacyTasks: the one-time historical backfill ─────────────────────
// Deal shapes below mirror what production actually holds after the Pipedrive
// migration (audited 2026-08-06: 300 open deals, 226 with only imported tasks).

test('legacy sweep: an imported open task does NOT satisfy the follow-up requirement', async () => {
  const db = makeDb({
    deals: [openDeal('d1')],
    tasks: [{ id: 'imported1', dealId: 'd1', taskTypeId: null, status: 'open', dueDate: new Date('2024-03-11T00:00:00Z') }],
    legacyTaskIds: ['imported1'],
  });
  const log = { warn() {}, log() {} };

  // The NIGHTLY rule is unchanged: any open task means the deal is being worked.
  const nightly = await runMissingTaskSweep({ dateStr: '2026-08-05', dryRun: true, db, log });
  assert.equal(nightly.candidates, 0, 'nightly automation must not change behaviour');

  const out = await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log });
  assert.equal(out.created, 1);
  assert.equal(out.legacyOnly, 1);
  assert.equal(out.noOpenTask, 0);
  // Same code path → indistinguishable from a nightly recovery task.
  const created = db._s.tasks.find((t) => t.id !== 'imported1');
  assert.equal(created.title, FOLLOW_UP_TITLE);
  assert.equal(created.taskTypeId, 'tt_follow');
  assert.equal(created.status, 'open');
  assert.equal(created.dueDate.toISOString(), '2026-08-05T00:00:00.000Z');
});

test('legacy sweep: the imported task is left completely untouched', async () => {
  const imported = { id: 'imported1', dealId: 'd1', taskTypeId: null, status: 'open', title: 'שיחת מעקב', dueDate: new Date('2024-03-11T00:00:00Z') };
  const db = makeDb({ deals: [openDeal('d1')], tasks: [imported], legacyTaskIds: ['imported1'] });
  const before = JSON.stringify(imported);
  await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log: { warn() {}, log() {} } });
  assert.equal(JSON.stringify(db._s.tasks.find((t) => t.id === 'imported1')), before, 'legacy history is read-only');
});

test('legacy sweep: an imported task that was TYPED by the backfill is still legacy', async () => {
  // Production holds 13 such rows — the owner-approved type backfill gave them
  // a real GOS taskTypeId. Origin, not the type column, decides.
  const db = makeDb({
    deals: [openDeal('d1')],
    tasks: [{ id: 'imported1', dealId: 'd1', taskTypeId: 'tt_follow', status: 'open', dueDate: new Date('2024-03-11T00:00:00Z') }],
    legacyTaskIds: ['imported1'],
  });
  const out = await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log: { warn() {}, log() {} } });
  assert.equal(out.created, 1);
  assert.equal(out.legacyOnly, 1);
});

test('legacy sweep: a native open task still counts — no duplicate task', async () => {
  const db = makeDb({
    deals: [openDeal('d1')],
    tasks: [
      { id: 'imported1', dealId: 'd1', taskTypeId: null, status: 'open', dueDate: new Date('2024-03-11T00:00:00Z') },
      { id: 'native1', dealId: 'd1', taskTypeId: 'tt_first', status: 'open', dueDate: new Date('2026-08-04T00:00:00Z') },
    ],
    legacyTaskIds: ['imported1'],
  });
  const out = await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log: { warn() {}, log() {} } });
  assert.equal(out.created, 0);
  assert.equal(out.alreadyActive, 1);
  assert.equal(db._s.tasks.length, 2);
});

test('legacy sweep: running it twice creates zero additional tasks', async () => {
  const db = makeDb({
    deals: [openDeal('d1'), openDeal('d2', { orderNo: 27001 }), openDeal('d3', { orderNo: 27002 })],
    tasks: [
      { id: 'imported1', dealId: 'd1', taskTypeId: null, status: 'open', dueDate: new Date('2024-03-11T00:00:00Z') },
      { id: 'imported2', dealId: 'd2', taskTypeId: null, status: 'open', dueDate: new Date('2024-05-02T00:00:00Z') },
      { id: 'native3', dealId: 'd3', taskTypeId: 'tt_follow', status: 'open', dueDate: new Date('2026-08-04T00:00:00Z') },
    ],
    legacyTaskIds: ['imported1', 'imported2'],
  });
  const log = { warn() {}, log() {} };
  const first = await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log });
  assert.deepEqual(
    { audited: first.audited, alreadyActive: first.alreadyActive, legacyOnly: first.legacyOnly, needRecovery: first.needRecovery, created: first.created },
    { audited: 3, alreadyActive: 1, legacyOnly: 2, needRecovery: 2, created: 2 },
  );
  const second = await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log });
  assert.equal(second.created, 0, 'idempotent');
  assert.equal(second.alreadyActive, 3, 'the tasks just created are themselves live GOS tasks');
  assert.equal(db._s.tasks.length, 5);

  // Second guard: even if an operator immediately COMPLETES the new tasks, a
  // rerun that same day must not spawn replacements.
  for (const t of db._s.tasks) if (t.title === FOLLOW_UP_TITLE) t.status = 'completed';
  const third = await runMissingTaskSweep({ dateStr: '2026-08-05', excludeLegacyTasks: true, db, log });
  assert.equal(third.created, 0, 'one recovery task per deal per day');
  assert.equal(third.sameDayBlocked, 2, 'd1+d2; d3 still holds its own live task');
  assert.equal(db._s.tasks.length, 5);
  for (const t of db._s.tasks) if (t.title === FOLLOW_UP_TITLE) t.status = 'open'; // restore

  // And the nightly job, running afterwards, now sees live tasks everywhere.
  const nightly = await runMissingTaskSweep({ dateStr: '2026-08-06', dryRun: true, db, log });
  assert.equal(nightly.candidates, 0);
});

test('legacy sweep: reports audited / already-valid / recovered counts', async () => {
  const db = makeDb({
    deals: [openDeal('d1'), openDeal('d2', { orderNo: 27001 }), openDeal('d3', { orderNo: 27002 }), openDeal('d4', { orderNo: 27003 })],
    tasks: [
      { id: 'imported1', dealId: 'd1', taskTypeId: null, status: 'open', dueDate: new Date('2024-03-11T00:00:00Z') },
      { id: 'native2', dealId: 'd2', taskTypeId: 'tt_follow', status: 'open', dueDate: new Date('2026-08-04T00:00:00Z') },
      { id: 'done3', dealId: 'd3', taskTypeId: 'tt_first', status: 'completed', dueDate: new Date('2026-08-01T00:00:00Z') },
    ],
    legacyTaskIds: ['imported1'],
  });
  const out = await runMissingTaskSweep({ dateStr: '2026-08-05', dryRun: true, excludeLegacyTasks: true, db, log: { warn() {}, log() {} } });
  assert.equal(out.audited, 4);
  assert.equal(out.alreadyActive, 1, 'only d2 holds a live GOS task');
  assert.equal(out.legacyOnly, 1, 'd1');
  assert.equal(out.noOpenTask, 2, 'd3 (completed only) + d4 (none)');
  assert.equal(out.needRecovery, 3);
  assert.equal(out.candidates, 3);
  assert.equal(db._s.tasks.length, 3, 'dry run writes nothing');
});

test('midnight sweep: WON/LOST deals are never touched; dryRun writes nothing', async () => {
  const db = makeDb({ deals: [openDeal('w1', { status: 'won' }), openDeal('l1', { status: 'lost' }), openDeal('d1')] });
  const dry = await runMissingTaskSweep({ dateStr: '2026-08-05', dryRun: true, db, log: { warn() {}, log() {} } });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.candidates, 1, 'only the open deal is a candidate');
  assert.equal(db._s.tasks.length, 0, 'dry run creates nothing');
});
