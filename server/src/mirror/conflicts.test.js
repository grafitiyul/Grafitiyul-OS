import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFLICT_TYPE, conflictDedupeKey, conflictIssueDef, displayValue, fieldLabel,
  raiseSyncConflict, resolveSyncConflict,
} from './conflicts.js';

function issueDb() {
  const rows = [];
  const db = {
    rows,
    operationalIssue: {
      findFirst: async ({ where }) =>
        rows.find((r) => r.dedupeKey === where.dedupeKey && ['open', 'acknowledged'].includes(r.status)) || null,
      create: async ({ data }) => { const row = { id: `i${rows.length + 1}`, status: 'open', ...data }; rows.push(row); return row; },
      update: async ({ where, data }) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => {
        const hits = rows.filter((r) => (where.id ? r.id === where.id : r.dedupeKey === where.dedupeKey)
          && ['open', 'acknowledged'].includes(r.status));
        hits.forEach((r) => Object.assign(r, data));
        return { count: hits.length };
      },
    },
  };
  return db;
}

const CONFLICTS = [
  { field: 'valueMinor', base: 500000, source: 400000, gos: 531000 },
  { field: 'status', base: 'open', source: 'won', gos: 'lost' },
];

test('a conflict is raised through the EXISTING control module, not a new surface', async () => {
  const db = issueDb();
  const issue = await raiseSyncConflict(db, {
    system: 'pipedrive', entity: 'deal', entityId: 'd1', orderNo: 12345, conflicts: CONFLICTS,
  });
  assert.equal(issue.type, CONFLICT_TYPE);
  assert.equal(issue.sourceModule, 'mirror');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.dedupeKey, 'legacy_sync_conflict:deal:d1');
});

test('one active issue per RECORD, not per field — a second raise refreshes it', async () => {
  const db = issueDb();
  const args = { system: 'pipedrive', entity: 'deal', entityId: 'd1', orderNo: 1, conflicts: CONFLICTS };
  await raiseSyncConflict(db, args);
  await raiseSyncConflict(db, args);
  assert.equal(db.rows.length, 1);
  assert.ok(db.rows[0].lastSeenAt, 'refreshed rather than duplicated');
});

test('no conflicts → nothing is raised', async () => {
  const db = issueDb();
  assert.equal(await raiseSyncConflict(db, { system: 'pipedrive', entity: 'deal', entityId: 'd1', conflicts: [] }), null);
  assert.equal(db.rows.length, 0);
});

test('the issue explains that NOTHING was overwritten — the core promise', async () => {
  const db = issueDb();
  const issue = await raiseSyncConflict(db, {
    system: 'pipedrive', entity: 'deal', entityId: 'd1', orderNo: 1, conflicts: CONFLICTS,
  });
  assert.match(issue.explanation, /לא בוצע שום עדכון אוטומטי/);
  assert.match(issue.title, /Pipedrive/);
});

test('values are rendered for humans — money in shekels, dates as dates', () => {
  assert.equal(displayValue('valueMinor', 531000), '5,310 ₪');
  assert.equal(displayValue('tourDate', '2026-08-01T00:00:00.000Z'), '2026-08-01');
  assert.equal(displayValue('title', null), '—');
  assert.equal(displayValue('title', ''), '—');
});

test('field names are business language, never database columns', () => {
  assert.equal(fieldLabel('valueMinor'), 'סכום');
  assert.equal(fieldLabel('dealStageId'), 'שלב');
  assert.equal(fieldLabel('tourDate'), 'תאריך הסיור');
});

test('the payload carries all THREE values so a human can actually decide', async () => {
  const db = issueDb();
  const issue = await raiseSyncConflict(db, {
    system: 'pipedrive', entity: 'deal', entityId: 'd1', orderNo: 1, conflicts: CONFLICTS,
  });
  const money = issue.data.fields.find((f) => f.field === 'valueMinor');
  assert.equal(money.label, 'סכום');
  assert.equal(money.legacy, '4,000 ₪');
  assert.equal(money.gos, '5,310 ₪');
  assert.equal(money.since, '5,000 ₪', 'the baseline is shown too — "what it was when we agreed"');
});

test('the issue links back to the record it is about', async () => {
  const db = issueDb();
  const issue = await raiseSyncConflict(db, {
    system: 'airtable', entity: 'tourEvent', entityId: 't1', entityLabel: 'סיור תל אביב', conflicts: [CONFLICTS[1]],
  });
  assert.deepEqual(issue.entityRefs, [{ type: 'tour_event', id: 't1', orderNo: null, label: 'סיור תל אביב' }]);
  assert.match(issue.title, /Airtable/);
});

test('resolving records WHICH choice was made', async () => {
  const db = issueDb();
  await raiseSyncConflict(db, { system: 'pipedrive', entity: 'deal', entityId: 'd1', conflicts: CONFLICTS });
  await resolveSyncConflict(db, { dedupeKey: 'legacy_sync_conflict:deal:d1', choice: 'accept_legacy', resolvedByName: 'דור' });
  assert.equal(db.rows[0].status, 'resolved');
  assert.equal(db.rows[0].resolution, 'mirror_accept_legacy');
  assert.equal(db.rows[0].resolvedByName, 'דור');
});

test('the dashboard offers exactly the three real choices, and no "sync back"', () => {
  const actions = conflictIssueDef.buildActions({
    data: { entity: 'deal', entityId: 'd1' },
    entityRefs: [{ orderNo: 12345 }],
  });
  const keys = actions.map((a) => a.key);
  assert.deepEqual(keys, ['open', 'accept_legacy', 'keep_gos']);
  assert.ok(!keys.some((k) => /push|write.*legacy|update.*pipedrive/i.test(k)), 'never offers a write back to legacy');
  assert.ok(actions.find((a) => a.key === 'accept_legacy').confirm, 'destructive choice is confirmed');
});
