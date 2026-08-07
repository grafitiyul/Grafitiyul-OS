// Prisma-shape contract test for the activity-type conversion service — the
// guard the fake-db blind spot demands (feedback: a stub suite stays green while
// a select/write naming a non-existent field 500s in production).
//
// The conversion service reads and writes across six models. Every field name it
// depends on is walked against the GENERATED Prisma DMMF here, so a schema rename
// breaks a test instead of breaking a live conversion.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { CONVERSION_DEAL_SELECT } from './activityConversion.js';
import { PENDING_DELIVERY_STATUSES } from '../communication/reconcileDealTour.js';

const model = (name) => Prisma.dmmf.datamodel.models.find((m) => m.name === name);

function assertFields(modelName, fields, { scalarOnly = true } = {}) {
  const m = model(modelName);
  assert.ok(m, `${modelName} model exists in the generated schema`);
  for (const key of fields) {
    const field = m.fields.find((f) => f.name === key);
    assert.ok(field, `${modelName}.${key} exists in the schema`);
    if (scalarOnly) {
      assert.notEqual(field.kind, 'object', `${modelName}.${key} is a scalar`);
    }
  }
}

test('CONVERSION_DEAL_SELECT only names real Deal scalar fields', () => {
  assertFields('Deal', Object.keys(CONVERSION_DEAL_SELECT));
});

test('Deal.conversionOpId exists and is UNIQUE — the idempotency guarantee', () => {
  const m = model('Deal');
  const field = m.fields.find((f) => f.name === 'conversionOpId');
  assert.ok(field, 'Deal.conversionOpId exists');
  assert.equal(field.type, 'String');
  assert.equal(field.isRequired, false, 'nullable — most deals were never converted');
  // The unique is what lets the DATABASE answer "already converted?", so two
  // concurrent requests cannot both win. Losing it would silently reduce
  // idempotency to a best-effort application check.
  assert.equal(field.isUnique, true, 'Deal.conversionOpId is UNIQUE');
});

test('the conversion writes only name real fields on every model it touches', () => {
  // The deal patch.
  assertFields('Deal', [
    'activityType', 'activityTypeAssumedAt', 'conversionOpId',
    'organizationId', 'organizationUnitId', 'organizationTypeId', 'organizationSubtypeId',
    'tourDate', 'tourTime', 'participants', 'status', 'valueMinor', 'currency',
  ], { scalarOnly: false });
  // The in-place kind update (private ⇄ business) + the calendar dirty-mark.
  assertFields('TourEvent', [
    'kind', 'status', 'date', 'startTime', 'capacity',
    'gcalSyncStatus', 'gcalSyncError', 'gcalNextRetryAt', 'gcalAttempts',
  ]);
  // The booking/seat sides the orchestration reads.
  assertFields('Booking', ['status', 'seats', 'dealId', 'tourEventId', 'cancelledAt']);
  assertFields('TicketRegistration', ['status', 'quantity', 'dealId', 'tourEventId']);
  // The delivery reconciliation.
  assertFields('CommunicationDelivery', [
    'dealId', 'tourEventId', 'status', 'waitReason', 'effectiveAt',
    'nextRetryAt', 'intendedAt', 'cancelledAt', 'triggerData', 'sessionId',
  ]);
});

test('every pending delivery status is a real state the worker also uses', () => {
  // Not a DMMF check (status is a plain string by project convention) but the
  // same class of guard: reconciliation must cover exactly the states a
  // delivery can sit in before sending, or a message slips through unreconciled.
  assert.deepEqual(
    [...PENDING_DELIVERY_STATUSES].sort(),
    ['failed', 'scheduled', 'waiting_dependency', 'waiting_window'],
  );
});
