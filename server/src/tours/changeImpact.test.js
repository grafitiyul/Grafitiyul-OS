import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  AFFECTED_REGISTRATIONS_SELECT,
  affectedRegistrations,
  emitTourChangeImpact,
  IMPACT_TYPE,
} from './changeImpact.js';
import { GENERIC_CUSTOMER_HE } from '../displayFallbacks.js';

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

// ── Prisma-shape contract (the fake-db blind spot, made concrete here) ────────
// The original select asked Deal for contactName/contactEmail/contactPhone —
// fields that DO NOT EXIST — so every emit threw PrismaClientValidationError
// in production (0 impact issues ever created) while this fixture suite stayed
// green. The select is now walked against the GENERATED DMMF, same walker as
// confirmation/prismaShape.test.js.

const MODELS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

function walk(modelName, tree, path) {
  assert.ok(MODELS[modelName], `${path}: unknown model ${modelName}`);
  for (const [key, value] of Object.entries(tree)) {
    const field = MODELS[modelName].fields.find((f) => f.name === key);
    assert.ok(field, `${path}.${key}: no such field on ${modelName}`);
    if (value === true) continue;
    assert.equal(field.kind, 'object', `${path}.${key}: nested select on a scalar`);
    const nested = value.include || value.select;
    if (nested) walk(field.type, nested, `${path}.${key}`);
  }
}

test('AFFECTED_REGISTRATIONS_SELECT matches the real schema (regression: contactName did not exist)', () => {
  walk('TicketRegistration', AFFECTED_REGISTRATIONS_SELECT, 'TicketRegistration');
});

// ── privacy: the affected-customers list feeds Part 4 customer notifications ──

test('privacy: the select never fetches Deal.title', () => {
  assert.ok(!('title' in AFFECTED_REGISTRATIONS_SELECT.deal.select));
  assert.ok(!JSON.stringify(AFFECTED_REGISTRATIONS_SELECT).includes('"title"'));
});

const regClient = (rows) => ({ ticketRegistration: { findMany: async () => rows } });
const leadDeal = (over = {}) => ({ id: 'd1', orderNo: 27001, organization: null, contacts: [], ...over });

test('privacy: name is registration → organization → contact → generic, NEVER Deal.title', async () => {
  const rows = [
    // The registration's own recorded customer wins.
    { id: 'r1', status: 'active', quantity: 2, dealId: 'd1', customerName: 'דנה מהאתר', customerEmail: null, customerPhone: null, deal: leadDeal() },
    // No registration identity → organization.
    { id: 'r2', status: 'active', quantity: 1, dealId: 'd1', customerName: null, customerEmail: null, customerPhone: null,
      deal: leadDeal({ organization: { name: 'עיריית תל אביב' } }) },
    // No organization → primary contact full name + primary phone/email.
    { id: 'r3', status: 'held', quantity: 3, dealId: 'd1', customerName: null, customerEmail: null, customerPhone: null,
      deal: leadDeal({ contacts: [{ contact: {
        firstNameHe: 'לילי', lastNameHe: 'כהן', firstNameEn: '', lastNameEn: '',
        phones: [{ value: '050-2', isPrimary: false }, { value: '050-1', isPrimary: true }],
        emails: [{ value: 'lili@x.co', isPrimary: true }],
      } }] }) },
    // Nothing at all → generic wording, never null and never the internal title.
    { id: 'r4', status: 'active', quantity: 1, dealId: 'd1', customerName: null, customerEmail: null, customerPhone: null, deal: leadDeal() },
  ];
  const out = await affectedRegistrations(regClient(rows), 't1');
  assert.deepEqual(out.map((c) => c.name), ['דנה מהאתר', 'עיריית תל אביב', 'לילי כהן', GENERIC_CUSTOMER_HE]);
  assert.equal(out[2].phone, '050-1', 'primary phone wins over list order');
  assert.equal(out[2].email, 'lili@x.co');
  assert.ok(!JSON.stringify(out).includes('ליד חדש'));
});
