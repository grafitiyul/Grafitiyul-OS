// Prisma-shape contract for the Cardcom payment state machine.
//
// touristPayment.test.js proves the LOGIC against a fake db — which by
// construction cannot notice a field that does not exist on the real model
// (the fake-db blind spot: a green suite while every production write 500s).
// This pins the exact columns and query shapes the state machine writes to the
// GENERATED Prisma DMMF. Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { ACTIVE_STATUSES, PAYABLE_STATUSES, TOURIST_DEAL_INCLUDE } from './touristPayment.js';

const MODELS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const fieldOf = (model, name) => MODELS[model]?.fields.find((f) => f.name === name) || null;

function walk(modelName, tree, path) {
  assert.ok(MODELS[modelName], `${path}: unknown model ${modelName}`);
  for (const [key, value] of Object.entries(tree)) {
    const field = fieldOf(modelName, key);
    assert.ok(field, `${path}.${key}: no such field on ${modelName}`);
    if (value === true) continue;
    assert.equal(field.kind, 'object', `${path}.${key}: nested select on a scalar`);
    const nested = value.include || value.select;
    if (nested) walk(field.type, nested, `${path}.${key}`);
  }
}

// Every column the duplicate-payment guards read or write.
const STATE_FIELDS = {
  status: 'String',
  returnedAt: 'DateTime',
  webhookAt: 'DateTime',
  lastVerifyAt: 'DateTime',
  attemptNo: 'Int',
  attemptHistory: 'Json',
  failReason: 'String',
  verifyHold: 'String',
  cardcomLowProfileId: 'String',
  cardcomPayUrl: 'String',
  snapshotHash: 'String',
  paidAt: 'DateTime',
  cardcomTransactionId: 'String',
  paidRaw: 'Json',
  rawProviderResponse: 'Json',
};

test('every state-machine field exists on PaymentRequest with the right type', () => {
  for (const [name, type] of Object.entries(STATE_FIELDS)) {
    const field = fieldOf('PaymentRequest', name);
    assert.ok(field, `PaymentRequest.${name} is missing from the schema`);
    assert.equal(field.type, type, `PaymentRequest.${name} should be ${type}`);
  }
});

test('attemptNo is required with a default (existing rows classify as attempt 1)', () => {
  const field = fieldOf('PaymentRequest', 'attemptNo');
  assert.equal(field.isRequired, true);
  assert.equal(field.hasDefaultValue, true);
});

test('the verification-lifecycle stamps are optional (unset until they happen)', () => {
  for (const name of ['returnedAt', 'webhookAt', 'lastVerifyAt', 'failReason', 'verifyHold']) {
    assert.equal(fieldOf('PaymentRequest', name).isRequired, false, `${name} must be nullable`);
  }
});

test('the בקרה detector include (deal.orderNo) matches the real schema', () => {
  walk('PaymentRequest', { deal: { select: { orderNo: true } } }, 'PaymentRequest');
});

test('TOURIST_DEAL_INCLUDE still matches the real schema', () => {
  walk('Deal', TOURIST_DEAL_INCLUDE, 'Deal');
});

test('status is a plain String column — the state set lives in code, not a DB enum', () => {
  // Additive by design: new states ship without a schema migration on the type.
  assert.equal(fieldOf('PaymentRequest', 'status').kind, 'scalar');
  for (const s of [...ACTIVE_STATUSES, ...PAYABLE_STATUSES, 'paid', 'canceled', 'expired']) {
    assert.equal(typeof s, 'string');
  }
});
