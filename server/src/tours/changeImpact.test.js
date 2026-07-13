import test from 'node:test';
import assert from 'node:assert/strict';
import { emitTourChangeImpact, IMPACT_TYPE } from './changeImpact.js';

// The canonical impact record: a first-class OperationalIssue (not an inline
// warning) that Part 4 consumes. Deduped by (impactType, tourEvent); repeated
// reconciliation updates the SAME open issue.

function fakeClient({ regs = [] } = {}) {
  const issues = [];
  const reqs = [];
  const client = {
    issues,
    reqs,
    ticketRegistration: { findMany: async () => regs },
    tourAssignment: { count: async () => 0 },
    issueRequirement: {
      upsert: async ({ where, create }) => {
        const k = where.issueId_revision_kind;
        let row = reqs.find((r) => r.issueId === k.issueId && r.revision === k.revision && r.kind === k.kind);
        if (!row) {
          row = { id: 'req' + (reqs.length + 1), state: 'pending', ...create };
          reqs.push(row);
        }
        return row;
      },
    },
    operationalIssue: {
      findFirst: async ({ where }) =>
        issues.find((i) => i.dedupeKey === where.dedupeKey && ['open', 'acknowledged'].includes(i.status)) || null,
      create: async ({ data }) => {
        const row = { id: 'iss' + (issues.length + 1), status: 'open', ...data };
        issues.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = issues.find((i) => i.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
  return client;
}

const REG = { id: 'r1', status: 'active', quantity: 2, dealId: 'd1', customerName: 'דנה', customerEmail: 'dana@x.com', customerPhone: '050', deal: null };

test('time change with registered customers → ONE canonical issue with before/after + customers', async () => {
  const c = fakeClient({ regs: [REG] });
  const issue = await emitTourChangeImpact(c, {
    tourEventId: 't1', impactType: 'tour_time_changed',
    before: { date: '2026-07-15', startTime: '18:00' }, after: { date: '2026-07-15', startTime: '19:00' },
  });
  assert.equal(issue.type, IMPACT_TYPE);
  assert.equal(issue.dedupeKey, `${IMPACT_TYPE}:tour_time_changed:t1`);
  assert.equal(issue.data.requiredAction, 'notify_customers');
  assert.equal(issue.data.affectedCount, 2);
  assert.equal(issue.data.customers[0].email, 'dana@x.com');
  assert.equal(issue.data.before.startTime, '18:00');
  assert.equal(issue.data.after.startTime, '19:00');
  assert.equal(c.issues.length, 1);
});

test('repeated reconcile updates the SAME issue (dedup), never a duplicate', async () => {
  const c = fakeClient({ regs: [REG] });
  const base = { tourEventId: 't1', impactType: 'tour_time_changed', before: { date: '2026-07-15', startTime: '18:00' } };
  await emitTourChangeImpact(c, { ...base, after: { date: '2026-07-15', startTime: '19:00' } });
  await emitTourChangeImpact(c, { ...base, after: { date: '2026-07-15', startTime: '20:00' } }); // materially different
  assert.equal(c.issues.length, 1);
  assert.equal(c.issues[0].data.after.startTime, '20:00'); // revision updated in place
});

test('customer-impact type with NO affected customers → no issue', async () => {
  const c = fakeClient({ regs: [] });
  const issue = await emitTourChangeImpact(c, { tourEventId: 't1', impactType: 'tour_cancelled', before: {}, after: {} });
  assert.equal(issue, null);
  assert.equal(c.issues.length, 0);
});

test('capacity below occupancy is actionable even without a customer list', async () => {
  const c = fakeClient({ regs: [] });
  const issue = await emitTourChangeImpact(c, { tourEventId: 't1', impactType: 'capacity_below_occupancy', before: { capacity: 20 }, after: { capacity: 5 } });
  assert.ok(issue);
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.data.requiredAction, 'review_capacity');
});
