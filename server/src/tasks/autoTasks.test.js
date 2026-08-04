import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureInitialCallTask, runMissingTaskSweep, FOLLOW_UP_TITLE } from './autoTasks.js';

// Fake-db harness covering exactly the prisma surface autoTasks touches.
function makeDb({ deals = [], tasks = [], types, admins } = {}) {
  const s = {
    deals: [...deals],
    tasks: [...tasks],
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

test('midnight sweep: WON/LOST deals are never touched; dryRun writes nothing', async () => {
  const db = makeDb({ deals: [openDeal('w1', { status: 'won' }), openDeal('l1', { status: 'lost' }), openDeal('d1')] });
  const dry = await runMissingTaskSweep({ dateStr: '2026-08-05', dryRun: true, db, log: { warn() {}, log() {} } });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.candidates, 1, 'only the open deal is a candidate');
  assert.equal(db._s.tasks.length, 0, 'dry run creates nothing');
});
