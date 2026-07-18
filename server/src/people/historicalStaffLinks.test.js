import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHistoricalStaffLinks,
  normalizeEmail,
  planSnapshotRepairs,
  groupByValue,
} from './historicalStaffLinks.js';

// A tiny in-memory Prisma-shaped fake supporting exactly the operations the
// service uses: findUnique(personRef), count(personRef/tourAssignment/payrollEntry)
// and updateMany(tourAssignment/payrollEntry). Implements the two filter shapes
// used: { equals, mode:'insensitive' } and personRefId:null.
function makeClient({ persons = [], assignments = [], payroll = [] } = {}) {
  const ci = (v) => String(v ?? '').toLowerCase();
  const matchExt = (row, where) => {
    if (where.personRefId === null && row.personRefId !== null) return false;
    const eq = where.externalPersonId?.equals;
    if (eq != null) return ci(row.externalPersonId) === ci(eq);
    return true;
  };
  const collection = (rows) => ({
    async count({ where }) {
      return rows.filter((r) => matchExt(r, where)).length;
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const r of rows) {
        if (matchExt(r, where)) { Object.assign(r, data); count += 1; }
      }
      return { count };
    },
  });
  return {
    personRef: {
      async findUnique({ where }) {
        return persons.find((p) => p.id === where.id) || null;
      },
      async count({ where }) {
        const eq = where.email?.equals;
        return persons.filter((p) => ci(p.email) === ci(eq)).length;
      },
    },
    tourAssignment: collection(assignments),
    payrollEntry: collection(payroll),
    _assignments: assignments,
    _payroll: payroll,
  };
}

test('normalizeEmail trims + lowercases', () => {
  assert.equal(normalizeEmail('  A@B.CoM '), 'a@b.com');
  assert.equal(normalizeEmail(null), '');
});

test('links unlinked assignments + payroll by email (case-insensitive)', async () => {
  const client = makeClient({
    persons: [{ id: 'pr1', email: 'Lyronne.Marciano@gmail.com', displayName: 'לירון מרציאנו' }],
    assignments: [
      { id: 'a1', personRefId: null, externalPersonId: 'lyronne.marciano@gmail.com' },
      { id: 'a2', personRefId: null, externalPersonId: 'lyronne.marciano@gmail.com' },
      { id: 'a3', personRefId: null, externalPersonId: 'someone.else@gmail.com' },
    ],
    payroll: [{ id: 'p1', personRefId: null, externalPersonId: 'lyronne.marciano@gmail.com' }],
  });
  const r = await resolveHistoricalStaffLinks(client, 'pr1');
  assert.equal(r.linkedAssignments, 2);
  assert.equal(r.linkedPayroll, 1);
  assert.equal(r.conflict, false);
  assert.equal(client._assignments.find((a) => a.id === 'a1').personRefId, 'pr1');
  assert.equal(client._assignments.find((a) => a.id === 'a3').personRefId, null); // untouched
});

test('idempotent — a second run links nothing new', async () => {
  const client = makeClient({
    persons: [{ id: 'pr1', email: 'a@b.com', displayName: 'A' }],
    assignments: [{ id: 'a1', personRefId: null, externalPersonId: 'a@b.com' }],
  });
  const first = await resolveHistoricalStaffLinks(client, 'pr1');
  const second = await resolveHistoricalStaffLinks(client, 'pr1');
  assert.equal(first.linkedAssignments, 1);
  assert.equal(second.linkedAssignments, 0);
});

test('never re-points a row already linked to another person', async () => {
  const client = makeClient({
    persons: [{ id: 'pr1', email: 'a@b.com', displayName: 'A' }],
    assignments: [{ id: 'a1', personRefId: 'prOther', externalPersonId: 'a@b.com' }],
  });
  const r = await resolveHistoricalStaffLinks(client, 'pr1');
  assert.equal(r.linkedAssignments, 0);
  assert.equal(client._assignments[0].personRefId, 'prOther');
});

test('ambiguous email (two PersonRefs share it) → conflict, no mutation', async () => {
  const client = makeClient({
    persons: [
      { id: 'pr1', email: 'dup@b.com', displayName: 'One' },
      { id: 'pr2', email: 'dup@b.com', displayName: 'Two' },
    ],
    assignments: [{ id: 'a1', personRefId: null, externalPersonId: 'dup@b.com' }],
  });
  const r = await resolveHistoricalStaffLinks(client, 'pr1');
  assert.equal(r.conflict, true);
  assert.equal(r.skippedReason, 'ambiguous_email');
  assert.equal(client._assignments[0].personRefId, null);
});

test('no email → skipped', async () => {
  const client = makeClient({ persons: [{ id: 'pr1', email: null, displayName: 'A' }] });
  const r = await resolveHistoricalStaffLinks(client, 'pr1');
  assert.equal(r.skippedReason, 'no_email');
});

test('non-email external identity (e.g. handle) is not matchable', async () => {
  const client = makeClient({ persons: [{ id: 'pr1', email: 'guide:13', displayName: 'A' }] });
  const r = await resolveHistoricalStaffLinks(client, 'pr1');
  assert.equal(r.skippedReason, 'email_not_matchable');
});

test('dry-run reports eligible counts, mutates nothing', async () => {
  const client = makeClient({
    persons: [{ id: 'pr1', email: 'a@b.com', displayName: 'A' }],
    assignments: [{ id: 'a1', personRefId: null, externalPersonId: 'a@b.com' }],
  });
  const r = await resolveHistoricalStaffLinks(client, 'pr1', { apply: false });
  assert.equal(r.linkedAssignments, 1);
  assert.equal(client._assignments[0].personRefId, null); // untouched
});

test('planSnapshotRepairs classifies rec-id rows safely', () => {
  const rows = [
    { id: 'x1', displayName: 'recQhpJc72rQPQ1c0', personRef: { displayName: 'לירון' }, externalPersonId: 'l@g.com' },
    { id: 'x2', displayName: 'recABCDEFGHIJKLMN', personRef: null, externalPersonId: 'gil@g.com' },
    { id: 'x3', displayName: 'recABCDEFGHIJKLMN', personRef: null, externalPersonId: 'legacy:recZZZ' },
    { id: 'x4', displayName: 'רון', personRef: null, externalPersonId: 'legacy:recYYY' }, // valid name — ignored
  ];
  const plan = planSnapshotRepairs(rows);
  assert.deepEqual(plan.toName, [{ id: 'x1', value: 'לירון' }]);
  assert.deepEqual(plan.toEmail, [{ id: 'x2', value: 'gil@g.com' }]);
  assert.deepEqual(plan.unresolved, [{ id: 'x3' }]);
});

test('groupByValue batches ids per distinct value', () => {
  const grouped = groupByValue([
    { id: 'a', value: 'X' },
    { id: 'b', value: 'X' },
    { id: 'c', value: 'Y' },
  ]);
  assert.deepEqual(grouped.get('X'), ['a', 'b']);
  assert.deepEqual(grouped.get('Y'), ['c']);
});
