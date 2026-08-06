import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { MESSAGE_SELECT, SCHEDULED_SELECT } from './timelineMerge.js';

// THE FAKE-DB BLIND SPOT, closed for this module.
//
// The row builders are pure and fully unit-tested, so a wrong FIELD NAME in the
// Prisma select sails past every one of them — the tests never touch Prisma.
// That is exactly what happened: SCHEDULED_SELECT asked for `lastError`, which
// does not exist on ScheduledEmail (it is `failureReason`). Every test was
// green and the Deal timeline 500'd in production, taking the whole history
// feed with it.
//
// This checks the selects against the GENERATED SCHEMA (DMMF) — the same source
// of truth Prisma validates against at runtime — so a renamed or imagined field
// fails here instead of in front of an operator.

function fieldsOf(modelName) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  assert.ok(model, `model ${modelName} exists`);
  return new Set(model.fields.map((f) => f.name));
}

// Scalars + relations asked for directly; nested selects are checked separately.
function assertSelectable(modelName, select) {
  const fields = fieldsOf(modelName);
  for (const key of Object.keys(select)) {
    if (key === '_count') continue; // handled below
    assert.ok(fields.has(key), `${modelName}.${key} must exist in the schema`);
  }
}

test('MESSAGE_SELECT only asks EmailMessage for fields it actually has', () => {
  assertSelectable('EmailMessage', MESSAGE_SELECT);
});

test('the nested thread select only asks EmailThread for real fields', () => {
  assertSelectable('EmailThread', MESSAGE_SELECT.thread.select);
});

test('the nested engagement select only asks EmailEngagement for real fields', () => {
  assertSelectable('EmailEngagement', MESSAGE_SELECT.engagement.select);
});

test('the filtered _count names a real EmailMessage relation', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'EmailMessage');
  for (const rel of Object.keys(MESSAGE_SELECT._count.select)) {
    const f = model.fields.find((x) => x.name === rel);
    assert.ok(f, `EmailMessage.${rel} exists`);
    assert.equal(f.isList, true, `EmailMessage.${rel} is a to-many relation (countable)`);
  }
});

test('SCHEDULED_SELECT only asks ScheduledEmail for fields it actually has', () => {
  // The exact regression: `lastError` is not a field — the column is
  // `failureReason`.
  assertSelectable('ScheduledEmail', SCHEDULED_SELECT);
  assert.ok(!('lastError' in SCHEDULED_SELECT), 'lastError does not exist on ScheduledEmail');
  assert.ok('failureReason' in SCHEDULED_SELECT, 'the real column is failureReason');
});

test('the idempotency filter keys on a real column', () => {
  // scheduledFeedItems filters on gmailMessageId — the whole "exactly once"
  // contract rests on that column existing.
  assert.ok(fieldsOf('ScheduledEmail').has('gmailMessageId'));
});
