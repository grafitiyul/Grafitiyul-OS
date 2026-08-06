// Prisma-shape contract for the post-payment settlement path — the guard the
// fake-db blind spot demands.
//
// Every write in this feature is exercised by an in-memory store that happily
// accepts a misspelled column, so a green suite proves nothing about the fields
// themselves. These assertions walk the real names against the GENERATED DMMF,
// which is the only thing that fails when the schema and the code disagree.
//
// What would otherwise reach production silently: `activityTypeAssumedAt`
// mistyped in settleDealWon would throw on the FIRST real payment — inside the
// settlement transaction, rolling back a WON for a customer who already paid.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const model = (name) => Prisma.dmmf.datamodel.models.find((m) => m.name === name);

function assertScalarFields(modelName, fields) {
  const m = model(modelName);
  assert.ok(m, `${modelName} model exists in the generated schema`);
  for (const key of fields) {
    const field = m.fields.find((f) => f.name === key);
    assert.ok(field, `${modelName}.${key} exists in the schema`);
    assert.notEqual(field.kind, 'object', `${modelName}.${key} is a scalar (plain write)`);
  }
}

test('the settlement writes only name real Deal scalar fields', () => {
  // Written by settleDealWon when the activity type had to be resolved, and
  // cleared by the deal PATCH / confirm-classification endpoints.
  assertScalarFields('Deal', ['activityType', 'activityTypeAssumedAt', 'organizationId', 'wonActor', 'status', 'orderNo']);
});

test('the money stamp only names real TicketRegistration scalar fields', () => {
  // stampSettledRegistration's where + data, the shared settlement record.
  assertScalarFields('TicketRegistration', [
    'dealId', 'tourEventId', 'status', 'paymentStatus', 'confirmedAt', 'noPaymentReason',
  ]);
});

test('the post-payment review card only names real ReviewItem scalar fields', () => {
  assertScalarFields('ReviewItem', [
    'kind', 'dedupeKey', 'title', 'summary', 'data', 'entityRefs', 'dealId', 'status',
    'handledAt', 'handledBy', 'handledByName',
  ]);
});

test('Deal.activityTypeAssumedAt is nullable — an unassumed deal must not need a value', () => {
  const f = model('Deal').fields.find((x) => x.name === 'activityTypeAssumedAt');
  assert.equal(f.isRequired, false, 'nullable: null means "human-chosen (or confirmed)"');
  assert.equal(f.type, 'DateTime');
});
