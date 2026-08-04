import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './testDb.js';
import { ingest } from './pipeline.js';
import { buildEvent } from './contract.js';
import { activityTypeForIngress } from './records.js';

// ── The rule this file protects ─────────────────────────────────────────────
// External LEAD intake never guesses an activity type. Until 2026-08 every
// ingress event without an organization was stamped 'private' (פרטי), which is
// a guess dressed as data — an operator could not tell it from a real
// classification. A PAID Woo order is 'group' (canonically known from the
// purchase); everything else stays unclassified.

const leadEvent = (over = {}) =>
  buildEvent({
    kind: 'lead',
    source: 'website_form',
    sourceKey: 'contact_page',
    person: { fullName: 'דור כהן', phone: '050-123-4567', email: 'dor@example.com' },
    context: { message: 'מעוניין בסיור' },
    ...over,
  });

const orderEvent = (over = {}) =>
  buildEvent({
    kind: 'order',
    source: 'woocommerce',
    sourceKey: 'primary',
    externalId: '5001',
    person: { fullName: 'רונית לוי', phone: '052-777-8888', email: 'ronit@example.com' },
    order: { total: '450.00', currency: 'ILS', status: 'processing', paid: true, items: [] },
    ...over,
  });

const dealFrom = (db) => db._tables.deal[0];

// ── 1. Website form lead ────────────────────────────────────────────────────
test('classification: an ordinary website lead is created with NO activity type', async () => {
  const db = createTestDb();
  const r = await ingest(
    { source: 'website_form', sourceKey: 'contact_page', rawPayload: {}, canonicalEvent: leadEvent() },
    db,
  );
  assert.equal(r.outcome, 'created_deal');
  const deal = dealFrom(db);
  assert.equal(deal.activityType, null, 'a website lead must not be classified as פרטי');
  assert.equal(deal.organizationTypeId, null);
  assert.equal(deal.organizationSubtypeId, null);
});

// ── 2. Meta Lead Ads lead ───────────────────────────────────────────────────
test('classification: a Meta lead is created with NO activity type', async () => {
  const db = createTestDb();
  await ingest(
    {
      source: 'meta_lead_ads',
      sourceKey: 'form_9',
      rawPayload: {},
      canonicalEvent: leadEvent({ source: 'meta_lead_ads', sourceKey: 'form_9' }),
    },
    db,
  );
  assert.equal(dealFrom(db).activityType, null, 'a Meta lead must not be classified as פרטי');
});

// The rule is canonical, not per-source: a source nobody has written yet must
// inherit it automatically. This is why the fix lives in records.js.
test('classification: an unknown future lead source inherits the same rule', async () => {
  const db = createTestDb();
  await ingest(
    {
      source: 'partner_portal',
      rawPayload: {},
      canonicalEvent: leadEvent({ source: 'partner_portal', sourceKey: null }),
    },
    db,
  );
  assert.equal(dealFrom(db).activityType, null);
});

// ── Paid Woo orders are canonically group ───────────────────────────────────
test('classification: a PAID Woo order is created as group', async () => {
  const db = createTestDb();
  await ingest(
    { source: 'woocommerce', sourceKey: 'primary', externalId: '5001', rawPayload: {}, canonicalEvent: orderEvent() },
    db,
  );
  assert.equal(dealFrom(db).activityType, 'group', 'a paid store purchase is a group activity');
});

test('classification: an UNPAID Woo order stays unclassified — never private', async () => {
  const db = createTestDb();
  await ingest(
    {
      source: 'woocommerce',
      sourceKey: 'primary',
      externalId: '5002',
      rawPayload: {},
      canonicalEvent: orderEvent({
        externalId: '5002',
        order: { total: '450.00', currency: 'ILS', status: 'pending', paid: false, items: [] },
      }),
    },
    db,
  );
  assert.equal(dealFrom(db).activityType, null);
});

// ── The organization SSOT still wins ────────────────────────────────────────
test('classification: a linked organization still forces business', async () => {
  const db = createTestDb({
    organizations: [{ id: 'org_1', name: 'בית ספר הדסים', organizationTypeId: null }],
  });
  await ingest(
    {
      source: 'website_form',
      rawPayload: {},
      canonicalEvent: leadEvent({ organization: { name: 'בית ספר הדסים' } }),
    },
    db,
  );
  const deal = dealFrom(db);
  assert.equal(deal.organizationId, 'org_1');
  assert.equal(deal.activityType, 'business', 'a linked organization is canonical business context');
});

// ── The pure rule, directly ─────────────────────────────────────────────────
test('activityTypeForIngress: the rule in isolation', () => {
  assert.equal(activityTypeForIngress({ kind: 'lead' }), null);
  assert.equal(activityTypeForIngress({ kind: 'lead', order: { paid: true } }), null);
  assert.equal(activityTypeForIngress({ kind: 'order', order: { paid: true } }), 'group');
  assert.equal(activityTypeForIngress({ kind: 'order', order: { paid: false } }), null);
  assert.equal(activityTypeForIngress({ kind: 'order', order: { paid: null } }), null);
  assert.equal(activityTypeForIngress({ kind: 'order' }), null);
  // 'private' must not be reachable from external intake at all any more.
  for (const kind of ['lead', 'order']) {
    for (const paid of [true, false, null, undefined]) {
      assert.notEqual(activityTypeForIngress({ kind, order: { paid } }), 'private');
    }
  }
});
