import test from 'node:test';
import assert from 'node:assert/strict';
import { contactSearchWhere } from './contactWhere.js';
import { phoneQuery } from './phoneQuery.js';

// A minimal Prisma-shaped stub. lookupPhoneContacts + lookupLegacy use
// `db.$queryRaw` (tagged template → a plain function call); lookupEmailContacts
// uses `db.contactEmail.findMany`. Each test supplies just what it needs.
function stubDb({ phoneRows = [], emailRows = [] } = {}) {
  let queryRawCalls = 0;
  return {
    // First $queryRaw call in Promise.all order is the phone lookup; legacy is
    // second. Phone gets the rows; legacy always empty here.
    $queryRaw: async () => (queryRawCalls++ === 0 ? phoneRows : []),
    contactEmail: { findMany: async () => emailRows },
  };
}

// Flatten the `or` array to the set of top-level keys used, for assertions.
function orKeys(or) {
  return or.map((clause) => Object.keys(clause)[0]);
}
function hasPhonesContainsClause(or) {
  // The historic bug: a `phones.some.value.contains` clause built from a name
  // token (empty string) that matched every phone. It must never appear.
  return or.some((c) => 'phones' in c);
}

test('name token: no phone/contactNo clause, no match-all phone leak', async () => {
  const { or } = await contactSearchWhere('דוד', phoneQuery('דוד'), stubDb());
  assert.equal(hasPhonesContainsClause(or), false, 'must not emit a phones.contains clause for a name');
  assert.ok(
    or.some((c) => 'firstNameHe' in c),
    'name fields must be searched',
  );
  assert.ok(!orKeys(or).includes('contactNo'), 'a non-numeric token is not a contact number');
  assert.ok(!or.some((c) => 'id' in c), 'no id-IN clause when nothing resolved by phone/email/legacy');
});

test('normalized phone: resolves candidates to an id-IN clause', async () => {
  const db = stubDb({ phoneRows: [{ contactId: 'c1', value: '050-123-4567' }] });
  const { or } = await contactSearchWhere('0501234567', phoneQuery('0501234567'), db);
  const idClause = or.find((c) => 'id' in c);
  assert.ok(idClause, 'phone match must add an id-IN clause');
  assert.deepEqual(idClause.id, { in: ['c1'] });
});

test('differently-formatted phone finds the same candidate row', async () => {
  // The SQL narrows by normalized digit-suffix, so the intl form and the local
  // form both target the same significant digits. We assert the query intent is
  // "exact" for a full number regardless of formatting.
  assert.equal(phoneQuery('+972501234567').kind, 'exact');
  assert.equal(phoneQuery('972501234567').kind, 'exact');
  assert.equal(phoneQuery('050-123-4567').kind, 'exact');
  assert.equal(phoneQuery('0501234567').kind, 'exact');
  const sig = phoneQuery('0501234567').significant;
  assert.equal(phoneQuery('+972501234567').significant, sig);
  assert.equal(phoneQuery('972-50-123-4567'.replace(/-/g, '')).significant, sig);
});

test('exact contact number within int4 is matched', async () => {
  const { or } = await contactSearchWhere('270', phoneQuery('270'), stubDb());
  const noClause = or.find((c) => 'contactNo' in c);
  assert.ok(noClause, 'a small numeric query is treated as a contact number');
  assert.equal(noClause.contactNo, 270);
});

test('long numeric query does NOT overflow the int4 contactNo column', async () => {
  // Regression: an 11-digit phone typed as one token used to be cast to
  // contactNo (int4 overflow → Prisma throws → 502). It must be dropped.
  const q = '05012345678';
  const { or } = await contactSearchWhere(q, phoneQuery(q), stubDb());
  assert.ok(!or.some((c) => 'contactNo' in c), 'must not build a contactNo clause that overflows int4');
});

test('empty search yields a match-everything where', async () => {
  const { where } = await contactSearchWhere('', phoneQuery(''), stubDb());
  // No tokens → contactNameOr('') still returns column clauses; the route guards
  // the empty-string case before calling this, but the builder must not throw.
  assert.ok(where.OR, 'returns an OR-shaped where without throwing');
});
