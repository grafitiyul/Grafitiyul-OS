// Prisma-shape contract test for the Duplicate Deal service — the guard the
// fake-db blind spot demands: a stub suite stays green while a copy list
// naming a non-existent field 500s every production duplicate. Walks the
// exported field lists against the GENERATED Prisma DMMF.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { COPY_SCALARS, LINE_FIELDS } from './duplicateDeal.js';

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

test('COPY_SCALARS only names real Deal scalar fields', () => {
  assertScalarFields('Deal', COPY_SCALARS);
});

test('LINE_FIELDS only names real QuoteLine scalar fields', () => {
  assertScalarFields('QuoteLine', LINE_FIELDS);
});

test('relation-copy writes only name real scalar fields', () => {
  assertScalarFields('DealContact', [
    'contactId',
    'roles',
    'isPrimary',
    'receiveConfirmations',
    'receiveOperationalUpdates',
    'receivePaymentLinks',
    'receiveQuotes',
  ]);
  assertScalarFields('QuoteOffer', ['offerNo', 'isPrimary', 'contextMode']);
  assertScalarFields('QuoteVersion', ['offerId', 'isWorking', 'status', 'vatMode']);
  assertScalarFields('DealTourPlan', ['notes', 'componentsCustomized']);
  assertScalarFields('DealTourPlanAssignment', [
    'personRefId',
    'externalPersonId',
    'displayName',
    'role',
    'notes',
  ]);
  assertScalarFields('DealTourPlanActivityComponent', [
    'activityComponentId',
    'workshopLocationId',
    'sortOrder',
  ]);
  assertScalarFields('DealConfirmation', ['fillers', 'overrideState']);
});

test('the lifecycle NEVER copies — the template must not smuggle outcome state', () => {
  const forbidden = [
    'status',
    'dealStageId',
    'wonAt',
    'wonQuoteRef',
    'lostAt',
    'lostReasonId',
    'lostNotes',
    'lostReason',
    'paymentToken',
    'orderNo',
    'collectionReviewStatus',
    'paymentReviewStatus',
    'lastMeaningfulActivityAt',
  ];
  for (const key of forbidden) {
    assert.ok(!COPY_SCALARS.includes(key), `Deal.${key} must never be in COPY_SCALARS`);
  }
});
