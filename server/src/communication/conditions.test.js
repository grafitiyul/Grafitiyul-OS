import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateApplicability, evaluateCondition } from './conditions.js';

const baseEvent = {
  activityMode: 'all', activityTypes: [], orgTypeIds: [], orgSubtypeIds: [], conditions: [],
};

test('activity include gate', () => {
  const event = { ...baseEvent, activityMode: 'include', activityTypes: ['business'] };
  assert.equal(evaluateApplicability(event, { deal: { activityType: 'business' } }).applicable, true);
  assert.equal(evaluateApplicability(event, { deal: { activityType: 'private' } }).applicable, false);
  assert.equal(evaluateApplicability(event, { deal: { activityType: null } }).applicable, false);
});

test('activity exclude gate', () => {
  const event = { ...baseEvent, activityMode: 'exclude', activityTypes: ['group'] };
  assert.equal(evaluateApplicability(event, { deal: { activityType: 'group' } }).applicable, false);
  assert.equal(evaluateApplicability(event, { deal: { activityType: 'private' } }).applicable, true);
});

test('linked organization forces business (classification SSOT)', () => {
  const event = { ...baseEvent, activityMode: 'include', activityTypes: ['business'] };
  const ctx = { deal: { activityType: 'private', organizationId: 'org1' } };
  assert.equal(evaluateApplicability(event, ctx).applicable, true);
});

test('org type filter uses the linked org type, falling back to the deal copy', () => {
  const event = { ...baseEvent, orgTypeIds: ['type_school'] };
  assert.equal(evaluateApplicability(event, {
    deal: { activityType: 'business', organizationId: 'o1' },
    org: { organizationTypeId: 'type_school' },
  }).applicable, true);
  assert.equal(evaluateApplicability(event, {
    deal: { activityType: 'business', organizationTypeId: 'type_school' },
  }).applicable, true);
  assert.equal(evaluateApplicability(event, {
    deal: { activityType: 'business', organizationTypeId: 'type_corp' },
  }).applicable, false);
});

test('org subtype filter', () => {
  const event = { ...baseEvent, orgSubtypeIds: ['sub1'] };
  assert.equal(evaluateApplicability(event, { deal: { organizationSubtypeId: 'sub1' } }).applicable, true);
  assert.equal(evaluateApplicability(event, { deal: { organizationSubtypeId: null } }).applicable, false);
});

test('generic conditions: eq / any_of / none_of / exists', () => {
  const ctx = {
    deal: { productId: 'p1', locationId: 'loc1', tourLanguage: 'en' },
    tour: { assignments: [{ id: 'a1' }] },
    payment: { status: 'partial' },
  };
  assert.equal(evaluateCondition({ field: 'product', op: 'eq', values: ['p1'] }, ctx).pass, true);
  assert.equal(evaluateCondition({ field: 'product', op: 'neq', values: ['p1'] }, ctx).pass, false);
  assert.equal(evaluateCondition({ field: 'location', op: 'any_of', values: ['loc1', 'loc2'] }, ctx).pass, true);
  assert.equal(evaluateCondition({ field: 'location', op: 'none_of', values: ['loc1'] }, ctx).pass, false);
  assert.equal(evaluateCondition({ field: 'tour_language', op: 'eq', values: ['en'] }, ctx).pass, true);
  assert.equal(evaluateCondition({ field: 'payment_status', op: 'any_of', values: ['partial', 'unpaid'] }, ctx).pass, true);
  assert.equal(evaluateCondition({ field: 'has_assigned_guide', op: 'exists' }, ctx).pass, true);
  assert.equal(evaluateCondition({ field: 'has_assigned_guide', op: 'exists' }, { tour: { assignments: [] } }).pass, false);
});

test('unknown field / op fails CLOSED with a reported error', () => {
  const r1 = evaluateCondition({ field: 'nope', op: 'eq', values: ['x'] }, {});
  assert.equal(r1.pass, false);
  assert.match(r1.error, /unknown_field/);
  const r2 = evaluateCondition({ field: 'product', op: 'nope' }, {});
  assert.equal(r2.pass, false);
});

test('AND semantics across conditions; checks report each result', () => {
  const event = {
    ...baseEvent,
    conditions: [
      { field: 'product', op: 'eq', values: ['p1'] },
      { field: 'tour_language', op: 'eq', values: ['he'] },
    ],
  };
  const r = evaluateApplicability(event, { deal: { productId: 'p1', tourLanguage: 'en' } });
  assert.equal(r.applicable, false);
  const productCheck = r.checks.find((c) => c.key === 'cond:product');
  const langCheck = r.checks.find((c) => c.key === 'cond:tour_language');
  assert.equal(productCheck.pass, true);
  assert.equal(langCheck.pass, false);
});
