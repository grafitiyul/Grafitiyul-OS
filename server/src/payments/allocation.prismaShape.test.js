// Prisma-shape contract for the multi-deal allocation service — the fake-db
// blind-spot guard. An in-memory harness stays green with a misspelled field
// while production 500s on it, and this module writes MONEY, so every column it
// touches is checked against the GENERATED DMMF here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const MODELS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const fieldOf = (model, name) => MODELS[model]?.fields.find((f) => f.name === name) || null;
const assertFields = (model, names) => {
  for (const n of names) assert.ok(fieldOf(model, n), `${model}.${n} does not exist`);
};
const uniqueOn = (model, names) =>
  (MODELS[model]?.uniqueIndexes || []).some(
    (u) => u.fields.length === names.length && names.every((n) => u.fields.includes(n)),
  );

test('IcountDocument carries every allocation + provenance column', () => {
  assertFields('IcountDocument', [
    'allocationMinor', 'allocationGroupId', 'allocationSource', 'allocationNote',
    'allocatedBy', 'allocatedByName', 'allocatedAt', 'sharedHistorical',
  ]);
  assert.equal(fieldOf('IcountDocument', 'allocationMinor').type, 'BigInt');
  assert.equal(fieldOf('IcountDocument', 'allocationMinor').isRequired, false);
  assert.equal(fieldOf('IcountDocument', 'allocatedAt').type, 'DateTime');
});

test('DealCollectionEvidence carries the SAME allocation contract as a document', () => {
  // Rule 8: one allocation concept over both physical tables. If these two
  // field sets ever diverge, a bank transfer and a receipt stop behaving alike.
  for (const f of [
    'allocationMinor', 'allocationGroupId', 'allocationSource', 'allocationNote',
    'allocatedBy', 'allocatedByName', 'allocatedAt',
  ]) {
    assert.ok(fieldOf('DealCollectionEvidence', f), `DealCollectionEvidence.${f} does not exist`);
    assert.equal(
      fieldOf('DealCollectionEvidence', f).type,
      fieldOf('IcountDocument', f).type,
      `${f} has a different type on the two payment tables`,
    );
  }
});

test('(allocationGroupId, dealId) is UNIQUE on both payment tables', () => {
  // THE idempotency guarantee: a retried apply can never create a second share
  // of the same payment for the same deal.
  assert.ok(uniqueOn('IcountDocument', ['allocationGroupId', 'dealId']));
  assert.ok(uniqueOn('DealCollectionEvidence', ['allocationGroupId', 'dealId']));
});

test('gateway payment truth is persistable on both payment tables', () => {
  for (const model of ['IcountDocument', 'DealCollectionEvidence']) {
    assertFields(model, [
      'paymentProvider', 'paymentTransactionId', 'paymentApprovalCode', 'paymentMeta',
    ]);
    assert.equal(fieldOf(model, 'paymentMeta').type, 'Json');
    // Never required — a gateway that says nothing must leave them null rather
    // than force a default, which is the whole #27151 lesson.
    assert.equal(fieldOf(model, 'paymentApprovalCode').isRequired, false);
  }
});

test('IcountDocument stores the FULL based_on list beside the legacy scalars', () => {
  assertFields('IcountDocument', ['basedOnDoctype', 'basedOnDocnum', 'basedOnDocs']);
  assert.equal(fieldOf('IcountDocument', 'basedOnDocs').type, 'Json');
  // Backward compatibility is structural: the scalars still exist, so every
  // reader written before multi-parent keeps working.
  assert.equal(fieldOf('IcountDocument', 'basedOnDoctype').type, 'String');
});

test('PaymentAllocationEvent records who/when/before/after for one deal', () => {
  assertFields('PaymentAllocationEvent', [
    'sourceKind', 'allocationGroupId', 'doctype', 'docnum', 'sourceAmountMinor',
    'action', 'dealId', 'orderNo', 'previousMinor', 'nextMinor', 'currency',
    'allocatedTotalMinor', 'unallocatedMinor', 'overAllocatedMinor',
    'reason', 'actorType', 'actorId', 'actorName', 'createdAt',
  ]);
  for (const f of ['sourceAmountMinor', 'previousMinor', 'nextMinor', 'allocatedTotalMinor']) {
    assert.equal(fieldOf('PaymentAllocationEvent', f).type, 'BigInt');
  }
  // Deliberately NOT a relation: the audit of where money was allocated must
  // survive the deletion of the deal it names.
  assert.equal(fieldOf('PaymentAllocationEvent', 'dealId').kind, 'scalar');
  assert.equal(fieldOf('PaymentAllocationEvent', 'deal'), null);
});

test('the collection resolver reads the columns it selects for company totals', () => {
  // companyCollectionTotals dedupes evidence by allocationGroupId; if that
  // select drifts from the schema the company total silently double-counts a
  // split payment.
  assertFields('DealCollectionEvidence', ['id', 'direction', 'amountMinor', 'allocationGroupId', 'allocationMinor']);
  assertFields('IcountDocument', ['dealId', 'doctype', 'docnum', 'amountMinor', 'paidMinor', 'sharedHistorical', 'allocationMinor']);
});

test('collection review status column still accepts the new truthful provenance', () => {
  // Free-text by project convention (no Postgres enums) — the guard here is
  // that the column exists and is a plain nullable String, which is what lets
  // 'paid_in_gos' ship without a migration of its own.
  const f = fieldOf('Deal', 'collectionReviewStatus');
  assert.ok(f);
  assert.equal(f.type, 'String');
  assert.equal(f.isRequired, false);
  assert.equal(fieldOf('Deal', 'collectionReviewStatusSource').type, 'String');
});
