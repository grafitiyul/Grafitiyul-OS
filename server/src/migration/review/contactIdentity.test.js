import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyIdentityEdit, validateIdentityEdits, resolveIdentityEdits, clusterKeySurvives,
  identityDecisionFor, identitySubjectKey, legacyIdFromSubjectKey, IDENTITY_QUEUE,
} from './contactIdentity.js';

// Fixtures are SYNTHETIC — this repo is public. They reproduce the shape of the two
// real corrections the owner found, never the people.
const shay = { legacyId: 1, name: 'איתי רון', phones: ['050-1112222'], emails: ['itay@example.com'] };
const sigal = { legacyId: 2, name: 'מיכל אבן', phones: ['054-3334444'], emails: ['itay@example.com'] };
const natasha = { legacyId: 3, name: 'רותם שדה', phones: ['054-3334444', '052-9998888'], emails: [] };

test('subject keys are per SOURCE CONTACT and round-trip', () => {
  assert.equal(IDENTITY_QUEUE, 'contact_identity');
  assert.equal(identitySubjectKey(7943), 'person:7943');
  assert.equal(legacyIdFromSubjectKey('person:7943'), 7943);
  assert.equal(legacyIdFromSubjectKey('contact:phone:972501111111'), null, 'never confuse a cluster key for a contact');
});

test('removing a wrong email leaves the record otherwise intact, and never mutates the source', () => {
  const frozen = JSON.stringify(sigal);
  const eff = applyIdentityEdit(sigal, { removeEmails: ['itay@example.com'] });
  assert.deepEqual(eff.emails, [], 'the wrong address is gone');
  assert.deepEqual(eff.phones, ['054-3334444'], 'everything else is untouched');
  assert.equal(eff.changed, true);
  assert.deepEqual(eff.removed.emails, ['itay@example.com']);
  assert.equal(JSON.stringify(sigal), frozen, 'THE SOURCE RECORD IS NEVER MUTATED');
});

test('no correction → the effective identity is exactly the source', () => {
  const eff = applyIdentityEdit(shay, null);
  assert.deepEqual(eff.phones, ['050-1112222']);
  assert.deepEqual(eff.emails, ['itay@example.com']);
  assert.equal(eff.changed, false);
});

test('a MOVE takes the identifier off one record and puts it on another', () => {
  const edits = {
    3: { removePhones: ['054-3334444'] },
    2: { addPhones: [{ value: '054-3334444', fromLegacyId: 3 }] },
  };
  const r = resolveIdentityEdits([sigal, natasha], edits);
  assert.equal(r.valid, true, r.problems.join(' · '));
  const byId = Object.fromEntries(r.records.map((x) => [x.legacyId, x]));
  assert.deepEqual(byId[3].effective.phones, ['052-9998888'], 'the wrong number is gone');
  assert.ok(byId[2].effective.phones.includes('054-3334444'), 'and lands on the right person');
  assert.deepEqual(byId[3].original.phones, ['054-3334444', '052-9998888'], 'the ORIGINAL is still reported');
  assert.equal(r.changedCount, 2);
});

test('an identifier can never be INVENTED — an add must come from a record in the cluster', () => {
  const r = validateIdentityEdits([sigal, natasha], {
    2: { addPhones: [{ value: '050-0000000', fromLegacyId: null }] },
  });
  assert.equal(r.valid, false);
  assert.match(r.problems.join(' '), /חייב להגיע מרשומה אחרת/);
});

test('an add is a MOVE, never a COPY — the giver must give it up in the same submission', () => {
  // Adding Natasha's phone to Sigal WITHOUT removing it from Natasha would put one
  // number on two people: exactly the mistake this tool exists to correct.
  const copy = validateIdentityEdits([sigal, natasha], {
    2: { addPhones: [{ value: '054-3334444', fromLegacyId: 3 }] },
  });
  assert.equal(copy.valid, false);
  assert.match(copy.problems.join(' '), /העברה, לא העתקה/);

  const move = validateIdentityEdits([sigal, natasha], {
    3: { removePhones: ['054-3334444'] },
    2: { addPhones: [{ value: '054-3334444', fromLegacyId: 3 }] },
  });
  assert.equal(move.valid, true);
});

test('a stale correction fails loudly instead of silently doing nothing', () => {
  const r = validateIdentityEdits([sigal], { 2: { removePhones: ['03-0000000'] } });
  assert.equal(r.valid, false);
  assert.match(r.problems.join(' '), /אינו קיים ברשומה/);
});

test('a correction cannot reach a record outside its cluster', () => {
  const r = validateIdentityEdits([sigal], { 999: { removePhones: ['x'] } });
  assert.equal(r.valid, false);
  assert.match(r.problems.join(' '), /אינה חלק מהקבוצה/);
});

test('stripping a record of every identifier is allowed, but warned about', () => {
  const r = validateIdentityEdits([sigal], { 2: { removePhones: ['054-3334444'], removeEmails: ['itay@example.com'] } });
  assert.equal(r.valid, true, 'the owner may legitimately do this');
  assert.match(r.warnings.join(' '), /לא יישאר אף טלפון או אימייל/);
});

test('the correction removes the very evidence that formed the cluster — and says so', () => {
  // The email cluster exists ONLY because both records carry the address. Take it
  // off the wrong record and the cluster has no premise left.
  const before = clusterKeySurvives({ clusterKind: 'email', clusterKey: 'itay@example.com', members: [shay, sigal], edits: {} });
  assert.equal(before.survives, true);

  const after = clusterKeySurvives({
    clusterKind: 'email', clusterKey: 'itay@example.com', members: [shay, sigal],
    edits: { 2: { removeEmails: ['itay@example.com'] } },
  });
  assert.equal(after.survives, false, 'the owner must be told the merge evidence is gone');
  assert.deepEqual(after.holders, [1]);
});

test('a phone cluster survives only while >=2 records still hold the number', () => {
  const members = [sigal, natasha];
  assert.equal(clusterKeySurvives({ clusterKind: 'phone', clusterKey: '972543334444', members, edits: {} }).survives, true);
  const after = clusterKeySurvives({
    clusterKind: 'phone', clusterKey: '972543334444', members,
    edits: { 3: { removePhones: ['054-3334444'] } },
  });
  assert.equal(after.survives, false);
});

test('the stored override states the END STATE, so the importer never re-derives intent', () => {
  const d = identityDecisionFor(sigal, { removeEmails: ['itay@example.com'] });
  assert.deepEqual(d.removeEmails, ['itay@example.com']);
  assert.deepEqual(d.effective, { phones: ['054-3334444'], emails: [] });
  assert.equal(d.legacyId, 2);
});
