// Confirmation Email — template resolution tests. Pure: no DB. Exercises the
// exactly-one rule, ambiguity refusal, and the preventive overlap validation.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  templateSpecificity,
  templateMatches,
  confirmationCtxFromDeal,
  selectConfirmationTemplate,
  findTemplateConflicts,
  templateShapeErrors,
  ConfirmationTemplateError,
} from './resolveTemplate.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
const tpl = (over = {}) => ({
  id: 'tpl_default',
  internalName: 'ברירת מחדל',
  isDefault: false,
  active: true,
  productIds: [],
  activityTypes: [],
  orgTypeIds: [],
  priority: 0,
  ...over,
});

const DEFAULT = tpl({ id: 'tpl_default', isDefault: true });
const AGENCIES = tpl({ id: 'tpl_agencies', orgTypeIds: ['ot_agency'] });
const SCHOOLS = tpl({ id: 'tpl_schools', orgTypeIds: ['ot_school'] });

const ctx = (over = {}) => ({
  productId: 'p1',
  activityType: 'private',
  orgTypeId: null,
  ...over,
});

// ── specificity + matching ───────────────────────────────────────────────────

test('specificity counts constrained dimensions', () => {
  assert.equal(templateSpecificity(DEFAULT), 0);
  assert.equal(templateSpecificity(AGENCIES), 1);
  assert.equal(templateSpecificity(tpl({ productIds: ['p1'], activityTypes: ['group'] })), 2);
});

test('empty scope list is a wildcard; non-empty requires membership', () => {
  assert.equal(templateMatches(DEFAULT, ctx()), true);
  assert.equal(templateMatches(AGENCIES, ctx({ orgTypeId: 'ot_agency' })), true);
  assert.equal(templateMatches(AGENCIES, ctx({ orgTypeId: 'ot_school' })), false);
  // a constrained dimension never matches a missing context value
  assert.equal(templateMatches(AGENCIES, ctx({ orgTypeId: null })), false);
});

// ── selection ────────────────────────────────────────────────────────────────

test('default wins when nothing specific matches', () => {
  const r = selectConfirmationTemplate([DEFAULT, AGENCIES, SCHOOLS], ctx());
  assert.equal(r.template.id, 'tpl_default');
  assert.equal(r.specificity, 0);
});

test('specific template beats the default', () => {
  const r = selectConfirmationTemplate(
    [DEFAULT, AGENCIES, SCHOOLS],
    ctx({ activityType: 'business', orgTypeId: 'ot_school' }),
  );
  assert.equal(r.template.id, 'tpl_schools');
});

test('higher specificity beats lower', () => {
  const two = tpl({ id: 'tpl_two', productIds: ['p1'], orgTypeIds: ['ot_school'] });
  const r = selectConfirmationTemplate(
    [DEFAULT, SCHOOLS, two],
    ctx({ orgTypeId: 'ot_school' }),
  );
  assert.equal(r.template.id, 'tpl_two');
});

test('priority breaks a tie inside equal specificity', () => {
  const a = tpl({ id: 'tpl_a', orgTypeIds: ['ot_school'], priority: 5 });
  const b = tpl({ id: 'tpl_b', orgTypeIds: ['ot_school'], priority: 1 });
  const r = selectConfirmationTemplate([DEFAULT, a, b], ctx({ orgTypeId: 'ot_school' }));
  assert.equal(r.template.id, 'tpl_a');
});

test('equal specificity AND equal priority → refuse, with the tied ids', () => {
  const a = tpl({ id: 'tpl_a', orgTypeIds: ['ot_school'] });
  const b = tpl({ id: 'tpl_b', activityTypes: ['business'] });
  assert.throws(
    () =>
      selectConfirmationTemplate(
        [DEFAULT, a, b],
        ctx({ activityType: 'business', orgTypeId: 'ot_school' }),
      ),
    (e) =>
      e instanceof ConfirmationTemplateError &&
      e.code === 'ambiguous_confirmation_template' &&
      e.meta.templateIds.includes('tpl_a') &&
      e.meta.templateIds.includes('tpl_b'),
  );
});

test('inactive templates are invisible to selection', () => {
  const r = selectConfirmationTemplate(
    [DEFAULT, tpl({ id: 'tpl_off', orgTypeIds: ['ot_school'], active: false })],
    ctx({ orgTypeId: 'ot_school' }),
  );
  assert.equal(r.template.id, 'tpl_default');
});

test('no matching template at all → no_confirmation_template', () => {
  assert.throws(
    () => selectConfirmationTemplate([AGENCIES], ctx()),
    (e) => e.code === 'no_confirmation_template',
  );
  assert.throws(
    () => selectConfirmationTemplate([], ctx()),
    (e) => e.code === 'no_confirmation_template',
  );
});

// ── deal → context (classification SSOT) ─────────────────────────────────────

test('an unclassified deal with an organization → business + the org\'s own type', () => {
  const c = confirmationCtxFromDeal({
    productId: 'p1',
    activityType: null,
    organizationId: 'org1',
    organization: { organizationTypeId: 'ot_agency' },
    organizationTypeId: 'ot_school', // contradicting deal-level copy must not win
  });
  assert.equal(c.activityType, 'business');
  assert.equal(c.orgTypeId, 'ot_agency');
});

test('an EXPLICIT private classification survives the linked organization', () => {
  // The customer-visible reason this rule changed: reading the org link as an
  // override selected the BUSINESS confirmation template — wrong framing, wrong
  // wording — for a company that deliberately booked a private tour. The ORG
  // TYPE half of the rule is untouched and still comes from the organization.
  const c = confirmationCtxFromDeal({
    productId: 'p1',
    activityType: 'private',
    organizationId: 'org1',
    organization: { organizationTypeId: 'ot_agency' },
    organizationTypeId: 'ot_school',
  });
  assert.equal(c.activityType, 'private');
  assert.equal(c.orgTypeId, 'ot_agency');
});

test('no organization → deal-owned classification', () => {
  const c = confirmationCtxFromDeal({
    productId: 'p1',
    activityType: 'group',
    organizationTypeId: 'ot_school',
  });
  assert.equal(c.activityType, 'group');
  assert.equal(c.orgTypeId, 'ot_school');
});

// ── preventive overlap validation ────────────────────────────────────────────

test('two wildcards at the same priority conflict', () => {
  const conflicts = findTemplateConflicts([DEFAULT, tpl({ id: 'tpl_wild2' })]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual([conflicts[0].aId, conflicts[0].bId].sort(), ['tpl_default', 'tpl_wild2']);
});

test('default vs specific never conflicts (different specificity)', () => {
  assert.deepEqual(findTemplateConflicts([DEFAULT, AGENCIES]), []);
});

test('equal-specificity cross-dimension overlap is detected', () => {
  const a = tpl({ id: 'tpl_a', orgTypeIds: ['ot_school'] });
  const b = tpl({ id: 'tpl_b', activityTypes: ['business'] });
  const conflicts = findTemplateConflicts([a, b]);
  assert.equal(conflicts.length, 1);
});

test('disjoint scope lists do not conflict', () => {
  assert.deepEqual(findTemplateConflicts([AGENCIES, SCHOOLS]), []);
});

test('different priority defuses an overlap', () => {
  const a = tpl({ id: 'tpl_a', orgTypeIds: ['ot_school'], priority: 1 });
  const b = tpl({ id: 'tpl_b', activityTypes: ['business'] });
  assert.deepEqual(findTemplateConflicts([a, b]), []);
});

test('inactive templates are excluded from conflict detection', () => {
  const conflicts = findTemplateConflicts([DEFAULT, tpl({ id: 'tpl_wild2', active: false })]);
  assert.deepEqual(conflicts, []);
});

// ── shape validation ─────────────────────────────────────────────────────────

test('the default template must stay all-wildcard', () => {
  assert.deepEqual(templateShapeErrors(DEFAULT), []);
  assert.deepEqual(
    templateShapeErrors(tpl({ isDefault: true, orgTypeIds: ['ot_school'] })),
    ['default_must_be_wildcard'],
  );
});

test('unknown activity types are rejected', () => {
  assert.deepEqual(templateShapeErrors(tpl({ activityTypes: ['vip'] })), ['invalid_activity_type']);
  assert.deepEqual(templateShapeErrors(tpl({ activityTypes: ['group', 'business'] })), []);
});
