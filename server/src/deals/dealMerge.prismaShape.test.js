// Prisma-shape contract test for Deal Merge — the guard the fake-db blind spot
// demands. A stub suite stays green while a field list naming a column that
// does not exist 500s every production merge, so every name the service reads
// or writes is walked against the GENERATED DMMF.
//
// This is deliberately stricter than the duplicate-deal twin: a merge writes to
// nine models and retires a deal, so the FK/index invariants that make the
// design safe (unique retiredDealId, unique opId, restrict-on-delete) are
// asserted here too. If someone weakens one in the schema, this fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { MERGE_DEAL_SELECT } from './dealMerge.js';
import { MERGE_FIELDS, NEVER_MERGED } from './mergeResolve.js';

const model = (name) => Prisma.dmmf.datamodel.models.find((m) => m.name === name);
const field = (m, name) => model(m)?.fields.find((f) => f.name === name);

function assertScalarFields(modelName, fields) {
  const m = model(modelName);
  assert.ok(m, `${modelName} model exists in the generated schema`);
  for (const key of fields) {
    const f = m.fields.find((x) => x.name === key);
    assert.ok(f, `${modelName}.${key} exists in the schema`);
    assert.notEqual(f.kind, 'object', `${modelName}.${key} is a scalar (plain write)`);
  }
}

test('MERGE_FIELDS only names real Deal scalar fields', () => {
  assertScalarFields('Deal', MERGE_FIELDS.map((f) => f.key));
});

test('every MERGE_FIELDS entry is documented for the operator', () => {
  for (const f of MERGE_FIELDS) {
    assert.ok(f.labelHe, `${f.key} has a Hebrew label (never a column name on screen)`);
    assert.ok(f.group, `${f.key} belongs to a display group`);
  }
});

test('MERGE_FIELDS dependent fields point at a field that exists in the table', () => {
  const keys = new Set(MERGE_FIELDS.map((f) => f.key));
  for (const f of MERGE_FIELDS) {
    if (!f.follows) continue;
    assert.ok(keys.has(f.follows), `${f.key} follows ${f.follows}, which must also be merged`);
  }
});

test('NEVER_MERGED names real Deal fields, with a reason for each', () => {
  assertScalarFields('Deal', Object.keys(NEVER_MERGED));
  for (const [key, reason] of Object.entries(NEVER_MERGED)) {
    assert.ok(reason && reason.length > 10, `${key} states WHY it never travels`);
  }
});

test('a field is never both merged and never-merged', () => {
  const merged = new Set(MERGE_FIELDS.map((f) => f.key));
  for (const key of Object.keys(NEVER_MERGED)) {
    assert.ok(!merged.has(key), `${key} cannot be both merged and never-merged`);
  }
});

test('MERGE_DEAL_SELECT names only real Deal fields', () => {
  assertScalarFields('Deal', Object.keys(MERGE_DEAL_SELECT));
});

test('the lineage columns exist on Deal', () => {
  assertScalarFields('Deal', ['mergedIntoDealId', 'mergedAt', 'mergeOpId']);
  const rel = field('Deal', 'mergedInto');
  assert.equal(rel?.kind, 'object', 'Deal.mergedInto is the survivor relation');
  const back = field('Deal', 'mergedFrom');
  assert.equal(back?.isList, true, 'Deal.mergedFrom lists the deals retired into this one');
});

test('DealMerge carries the full decision audit', () => {
  assertScalarFields('DealMerge', [
    'survivorDealId', 'survivorOrderNo', 'retiredDealId', 'retiredOrderNo',
    'opId', 'actorUserId', 'actorName', 'mergedAt', 'decisions', 'outcome',
  ]);
});

test('a deal can be retired at most ONCE (the DB enforces it, not a code path)', () => {
  const f = field('DealMerge', 'retiredDealId');
  assert.equal(f?.isUnique, true, 'DealMerge.retiredDealId is unique');
});

test('idempotency is enforced by unique indexes on BOTH sides', () => {
  assert.equal(field('DealMerge', 'opId')?.isUnique, true, 'DealMerge.opId is unique');
  assert.equal(field('Deal', 'mergeOpId')?.isUnique, true, 'Deal.mergeOpId is unique');
});

test('neither deal in a recorded merge can be deleted out from under it', () => {
  // RESTRICT, never CASCADE: cascading here would let deleting one deal erase
  // the evidence that the merge ever happened.
  for (const name of ['survivorDeal', 'retiredDeal']) {
    const f = field('DealMerge', name);
    assert.equal(f?.relationOnDelete, 'Restrict', `DealMerge.${name} is RESTRICT on delete`);
  }
  assert.equal(
    field('Deal', 'mergedInto')?.relationOnDelete,
    'Restrict',
    'a survivor cannot be deleted while deals point at it',
  );
});

test('the financial tables merge NEVER writes to still cascade from Deal', () => {
  // The reason retire-don't-delete exists. If any of these ever stopped
  // cascading, deleting a deal would no longer destroy its documents — and the
  // merge design could be revisited. Until then this is the proof of the
  // constraint the whole feature is built around.
  for (const m of ['IcountDocument', 'DealCollectionEvidence', 'PaymentRequest', 'QuoteVersion', 'QuoteDocument']) {
    const f = field(m, 'deal');
    assert.equal(f?.relationOnDelete, 'Cascade', `${m}.deal still cascades from Deal`);
  }
});

test('the tables merge re-parents are writable scalars', () => {
  assertScalarFields('Booking', ['dealId', 'seats', 'status']);
  assertScalarFields('TicketRegistration', ['dealId', 'externalOrderId', 'bookingId', 'status', 'quantity']);
  assertScalarFields('Task', ['dealId', 'status', 'cancelledAt']);
  assertScalarFields('DealContact', [
    'dealId', 'contactId', 'roles', 'isPrimary',
    'receiveConfirmations', 'receiveOperationalUpdates', 'receivePaymentLinks', 'receiveQuotes',
  ]);
  assertScalarFields('QuoteLine', [
    'quoteVersionId', 'kind', 'label', 'productVariantId', 'addonId', 'quantity',
    'unitPriceMinor', 'discountPercent', 'discountFixedMinor', 'vatMode', 'vatRate',
    'active', 'note', 'overridden', 'sourceKind', 'sourceCardGroupId',
    'pinnedCardGroupId', 'ticketTypeId', 'sortOrder',
  ]);
  assertScalarFields('QuoteVersion', ['dealId', 'offerId', 'isWorking', 'status', 'vatMode', 'dealDiscountPercent', 'dealDiscountFixedMinor']);
});

test('the PriceList columns the VAT fallback reads exist', () => {
  // A wrong name here silently falls back to 18% VAT on a merged total.
  assertScalarFields('PriceList', ['isDefault', 'active', 'defaultVatMode', 'defaultVatRate']);
});
