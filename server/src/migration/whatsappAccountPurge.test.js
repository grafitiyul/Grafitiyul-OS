import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WA_SCOPED_TABLES, columnExists, executeAccountPurge, planAccountPurge,
  tableExists, verifyNoResidualDependency,
} from './whatsappAccountPurge.js';

function waDb({ counts = {}, missingTables = [], missingColumns = [], account = { id: 'personal_test', label: 'test', active: true, status: 'connected', phoneJid: 'j' } } = {}) {
  const executed = [];
  const db = {
    executed,
    _counts: { ...counts },
    whatsAppAccount: {
      findUnique: async ({ where }) => (where.id === account?.id ? account : null),
      count: async () => 0,
    },
    async $queryRawUnsafe(sql, ...p) {
      if (sql.includes('information_schema.tables')) return missingTables.includes(p[0]) ? [] : [{ ok: 1 }];
      if (sql.includes('information_schema.columns')) return missingColumns.includes(p[1]) ? [] : [{ ok: 1 }];
      const m = sql.match(/FROM "([^"]+)"/);
      if (sql.includes('count(DISTINCT "contactId")')) return [{ n: 34 }];
      if (sql.includes('JOIN "WhatsAppScheduledMessage"')) return [{ n: 2 }];
      if (m) return [{ n: db._counts[m[1]] ?? 0 }];
      return [];
    },
    async $transaction(fn) {
      // Models Postgres: once a statement fails, every later statement in the
      // SAME transaction fails too, until the block ends.
      let poisoned = false;
      const tx = {
        async $executeRawUnsafe(sql, ...p) {
          if (poisoned) {
            const e = new Error('current transaction is aborted, commands ignored until end of transaction block');
            e.code = '25P02';
            throw e;
          }
          const m = sql.match(/(?:FROM|UPDATE) "([^"]+)"/);
          const table = m?.[1];
          if (missingTables.includes(table) || (sql.startsWith('UPDATE "Task"') && missingColumns.includes('whatsappScheduledMessageId'))) {
            poisoned = true;
            const e = new Error(`relation/column does not exist: ${table}`);
            e.code = '42P01';
            throw e;
          }
          executed.push(sql.split('\n')[0].trim());
          if (sql.startsWith('DELETE')) { const n = db._counts[table] ?? 0; db._counts[table] = 0; return n; }
          return 0;
        },
      };
      return fn(tx);
    },
  };
  return db;
}

const COUNTS = {
  WhatsAppMessage: 20489, WhatsAppChat: 224, WhatsAppSession: 26714,
  WhatsAppDataGap: 1355, WhatsAppOutboundIdempotency: 51, WhatsAppScheduledMessage: 10,
  WhatsAppMessageReaction: 0, WhatsAppAccount: 1,
};
const TOTAL = 48843;

test('the plan totals every account-scoped table', async () => {
  const plan = await planAccountPurge(waDb({ counts: COUNTS }), 'personal_test');
  assert.equal(plan.totalRows, TOTAL);
  assert.equal(plan.linkedContacts, 34);
  assert.deepEqual(Object.keys(plan.counts), [...WA_SCOPED_TABLES]);
});

test('an unknown account is refused', async () => {
  await assert.rejects(() => planAccountPurge(waDb({}), 'nope'), (e) => e.code === 'UNKNOWN_ACCOUNT');
});

test('the purge refuses without an approved row count', async () => {
  await assert.rejects(
    () => executeAccountPurge(waDb({ counts: COUNTS }), 'personal_test', { dryRun: false }),
    (e) => e.code === 'NO_EXPECTED_ROWS',
  );
});

test('the purge refuses when the LIVE number gained rows since planning', async () => {
  await assert.rejects(
    () => executeAccountPurge(waDb({ counts: COUNTS }), 'personal_test', { expectedRows: TOTAL - 5, dryRun: false }),
    (e) => e.code === 'ROW_COUNT_CHANGED',
  );
});

test('a dry run writes nothing', async () => {
  const db = waDb({ counts: COUNTS });
  const res = await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: true });
  assert.equal(db.executed.length, 0);
  assert.equal(res.totalDeleted, TOTAL + 1);
});

test('execution deletes children first, then the account row', async () => {
  const db = waDb({ counts: COUNTS });
  const res = await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: false });
  const tables = db.executed.map((s) => s.match(/"([^"]+)"/)[1]);
  assert.equal(tables[tables.length - 1], 'WhatsAppAccount', 'the account row goes last');
  assert.ok(tables.indexOf('WhatsAppMessage') < tables.indexOf('WhatsAppChat'), 'messages before chats');
  assert.equal(res.deleted.WhatsAppAccount, 1);
});

test('a CRM task pointing at a scheduled message is unlinked, not deleted', async () => {
  const db = waDb({ counts: COUNTS });
  await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: false });
  assert.ok(db.executed.some((s) => s.startsWith('UPDATE "Task"')), 'the link is nulled');
  assert.ok(!db.executed.some((s) => s.includes('DELETE FROM "Task"')), 'the task itself survives');
});

test('CONTACTS are never deleted — chats are link-only', async () => {
  const db = waDb({ counts: COUNTS });
  await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: false });
  assert.ok(!db.executed.some((s) => /DELETE FROM "Contact"/.test(s)), 'no contact is ever removed');
});

// The bug this test exists for: catching a failed statement INSIDE a Postgres
// transaction does not reset it — every later statement fails with 25P02. The
// fix is to probe the schema BEFORE the transaction opens.
test('an absent column does NOT poison the transaction (probed before it opens)', async () => {
  const db = waDb({ counts: COUNTS, missingColumns: ['whatsappScheduledMessageId'] });
  const res = await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: false });
  assert.ok(!db.executed.some((s) => s.startsWith('UPDATE "Task"')), 'the invalid statement is never issued');
  assert.equal(res.deleted.WhatsAppAccount, 1, 'and the purge still completes');
});

test('an absent table does NOT poison the transaction either', async () => {
  const db = waDb({ counts: COUNTS, missingTables: ['WhatsAppMessageReaction'] });
  const res = await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: false });
  assert.ok(!db.executed.some((s) => s.includes('WhatsAppMessageReaction')));
  assert.equal(res.deleted.WhatsAppAccount, 1);
});

test('schema probes answer honestly', async () => {
  const db = waDb({ missingTables: ['Nope'], missingColumns: ['nope'] });
  assert.equal(await tableExists(db, 'WhatsAppChat'), true);
  assert.equal(await tableExists(db, 'Nope'), false);
  assert.equal(await columnExists(db, 'Task', 'id'), true);
  assert.equal(await columnExists(db, 'Task', 'nope'), false);
});

test('the residual check proves the goal: nothing still references the account', async () => {
  const db = waDb({ counts: COUNTS });
  const before = await verifyNoResidualDependency(db, 'personal_test');
  assert.equal(before.clean, false, 'before the purge there IS residue');
  await executeAccountPurge(db, 'personal_test', { expectedRows: TOTAL, dryRun: false });
  db._counts.WhatsAppAccount = 0;
  const after = await verifyNoResidualDependency(db, 'personal_test');
  assert.equal(after.clean, true);
  assert.deepEqual(after.findings, []);
});
