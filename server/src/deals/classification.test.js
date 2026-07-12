// Regression tests for the Deal ↔ Organization classification rule.
// Pure unit tests, no DB — run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClassification } from './classification.js';

// ── Bug #1: group deal + attach organization → becomes business ──────────────

test('group deal → attach organization → automatically business, no deal-level type', () => {
  const out = normalizeClassification({
    organizationId: 'org1',
    activityType: 'group', // the deal's existing (now wrong) classification
    organizationTypeId: null,
    organizationSubtypeId: null,
    orgTypeId: 'municipality',
    subtypeTypeId: null,
  });
  assert.deepEqual(out, {
    activityType: 'business',
    organizationTypeId: null,
    organizationSubtypeId: null,
  });
});

test('private deal → attach organization → also forced business', () => {
  const out = normalizeClassification({
    organizationId: 'org1',
    activityType: 'private',
    orgTypeId: 'school',
  });
  assert.equal(out.activityType, 'business');
});

// ── Bug #2: manual type must never survive next to a linked organization ─────

test('business deal with manual type (school) + attach municipality org → deal-level type cleared', () => {
  const out = normalizeClassification({
    organizationId: 'org-muni',
    activityType: 'business',
    organizationTypeId: 'school', // stale manual pick — must not persist
    organizationSubtypeId: null,
    orgTypeId: 'municipality',
    subtypeTypeId: null,
  });
  // organizationTypeId is force-nulled → every reader resolves the ORG's type.
  assert.equal(out.organizationTypeId, null);
  assert.equal(out.activityType, 'business');
});

test('replacing the organization keeps the deal-level type cleared (org stays the truth)', () => {
  const out = normalizeClassification({
    organizationId: 'org-2',
    activityType: 'business',
    organizationTypeId: null, // already cleared by the first attach
    organizationSubtypeId: null,
    orgTypeId: 'producers',
    subtypeTypeId: null,
  });
  assert.equal(out.organizationTypeId, null);
  assert.equal(out.activityType, 'business');
});

// ── Subtype scoping on attach/replace ────────────────────────────────────────

test('subtype scoped to another type is cleared when the org type differs', () => {
  const out = normalizeClassification({
    organizationId: 'org1',
    activityType: 'business',
    organizationTypeId: null,
    organizationSubtypeId: 'elementary', // belongs to "school"
    orgTypeId: 'municipality',
    subtypeTypeId: 'school',
  });
  assert.equal(out.organizationSubtypeId, null);
});

test('subtype matching the org type survives', () => {
  const out = normalizeClassification({
    organizationId: 'org1',
    activityType: 'business',
    organizationSubtypeId: 'elementary',
    orgTypeId: 'school',
    subtypeTypeId: 'school',
  });
  assert.equal(out.organizationSubtypeId, 'elementary');
});

test('generic (type-less) subtype always survives an org attach', () => {
  const out = normalizeClassification({
    organizationId: 'org1',
    activityType: 'business',
    organizationSubtypeId: 'vip',
    orgTypeId: 'municipality',
    subtypeTypeId: null, // generic subtype
  });
  assert.equal(out.organizationSubtypeId, 'vip');
});

test('subtype with a parent type is cleared when the org has NO type', () => {
  const out = normalizeClassification({
    organizationId: 'org1',
    activityType: 'business',
    organizationSubtypeId: 'elementary',
    orgTypeId: null, // org without a type — a "school" subtype contradicts nothing… but has no parent to belong to
    subtypeTypeId: 'school',
  });
  assert.equal(out.organizationSubtypeId, null);
});

// ── Org removal / no org: manual selection is authoritative again ────────────

test('remove organization → manual classification persists exactly as sent', () => {
  const out = normalizeClassification({
    organizationId: null,
    activityType: 'group',
    organizationTypeId: null,
    organizationSubtypeId: null,
  });
  assert.deepEqual(out, {
    activityType: 'group',
    organizationTypeId: null,
    organizationSubtypeId: null,
  });
});

test('no org → deal-level type + subtype are kept (deal owns them)', () => {
  const out = normalizeClassification({
    organizationId: null,
    activityType: 'business',
    organizationTypeId: 'school',
    organizationSubtypeId: 'elementary',
  });
  assert.deepEqual(out, {
    activityType: 'business',
    organizationTypeId: 'school',
    organizationSubtypeId: 'elementary',
  });
});

test('empty-string inputs normalise to null (API sends "" for cleared selects)', () => {
  const out = normalizeClassification({
    organizationId: '',
    activityType: '',
    organizationTypeId: '',
    organizationSubtypeId: '',
  });
  assert.deepEqual(out, {
    activityType: null,
    organizationTypeId: null,
    organizationSubtypeId: null,
  });
});
