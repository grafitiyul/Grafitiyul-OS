import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeName, defaultFields, validateContactNames, buildNameCleanupProposals,
  resolveNameResult, nameDraftFromProposal, nameSubjectKey, scriptOf,
} from './nameCleanup.js';

// Fixtures are SYNTHETIC — this repo is public. They reproduce the shapes measured
// in Snapshot #1, never the people.
const c = (o) => ({
  legacyId: o.id, name: o.name ?? `${o.first || ''} ${o.last || ''}`.trim(),
  firstName: o.first ?? null, lastName: o.last ?? null,
  phones: o.phones || [], emails: o.emails || [], orgId: o.orgId ?? null, orgName: o.orgName ?? null,
  dealCount: o.deals || 0, openDealCount: o.open || 0, futureTourDeals: o.tours || 0,
  wonRecentDealCount: o.wonRecent || 0, activityCount: o.acts || 0, noteCount: o.notes || 0, fileCount: 0,
});

test('the canonical GOS rule is mirrored exactly: a first name in EITHER language', () => {
  assert.equal(validateContactNames({ firstNameHe: 'דנה', lastNameHe: '', firstNameEn: '', lastNameEn: '' }).valid, true);
  assert.equal(validateContactNames({ firstNameHe: '', lastNameHe: '', firstNameEn: 'Dana', lastNameEn: '' }).valid, true);
  // A surname alone is exactly what routes/contacts.js rejects.
  assert.equal(validateContactNames({ firstNameHe: '', lastNameHe: 'כהן', firstNameEn: '', lastNameEn: '' }).valid, false);
});

test('a first name with NO surname is valid and never enters the queue', () => {
  // 5,831 importable contacts look like this in Snapshot #1. They are complete.
  assert.equal(analyzeName({ name: 'אילנה', first_name: 'אילנה', last_name: '' }), null);
  assert.equal(analyzeName({ name: 'Dana', first_name: 'Dana', last_name: '' }), null);
  assert.equal(analyzeName({ name: 'דנה כהן', first_name: 'דנה', last_name: 'כהן' }), null);
  assert.equal(analyzeName({ name: 'Dana Cohen', first_name: 'Dana', last_name: 'Cohen' }), null);
});

test('the default import mapping splits by script and leaves the other pair empty', () => {
  assert.deepEqual(defaultFields('דנה', 'כהן'), { firstNameHe: 'דנה', lastNameHe: 'כהן', firstNameEn: '', lastNameEn: '' });
  assert.deepEqual(defaultFields('Dana', 'Cohen'), { firstNameHe: '', lastNameHe: '', firstNameEn: 'Dana', lastNameEn: 'Cohen' });
  assert.equal(scriptOf('דנה'), 'he');
  assert.equal(scriptOf('Dana'), 'en');
  assert.equal(scriptOf('דנה Cohen'), 'mixed');
  assert.equal(scriptOf('-'), 'other');
  assert.equal(scriptOf(''), 'empty');
});

test('a name living only in last_name would FAIL the import, and is NEVER auto-fixed', () => {
  const a = analyzeName({ name: 'לוי', first_name: '', last_name: 'לוי' });
  assert.ok(a.issues.includes('no_first_name'));
  assert.equal(a.treatment, 'import');
  assert.deepEqual(a.fields, { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' });
  // The default mapping (no cleanup) really does fail — that is why this is blocking.
  assert.equal(validateContactNames(defaultFields('', 'לוי')).valid, false);
  assert.equal(validateContactNames(a.fields).valid, true);
  // ...but moving the string is only identity-preserving if this is a PERSON.
  assert.equal(a.deterministic, false, 'we cannot know a person from a company — the owner decides');
});

// The regression that a live sample caught before any batch was approved. Moving a
// surname-only value into the first-name field is mechanically trivial, which is
// exactly why it looked "deterministic" — but the measured population of this class
// is dominated by ORGANISATIONS that no generic pattern catches. Auto-approving it
// would have created GOS "people" named after companies.
test('a surname-only ORGANISATION is never batch-approved into a person', () => {
  for (const org of ['חייקין כהן ושות', 'Israel Luxury Tours', 'MD CLONE', 'renacer tours', 'ידידים']) {
    const a = analyzeName({ name: org, first_name: '', last_name: org });
    assert.ok(a, `${org} must be surfaced`);
    assert.equal(a.deterministic, false, `"${org}" must never be auto-approved into a first name`);
  }
  const { proposals, stats } = buildNameCleanupProposals({
    contacts: [c({ id: 1, first: '', last: 'Israel Luxury Tours', deals: 1 })],
  });
  assert.equal(proposals[0].batchApprovable, false);
  assert.equal(stats.batchApprovable, 0);
  assert.equal(stats.needsIndividualReview, 1);
});

test('every batch-approvable fix leaves the FIRST NAME byte-identical', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [
      c({ id: 1, first: 'אודליה', last: '-', deals: 2 }),
      c({ id: 2, first: 'אבישי', last: '972506063744', acts: 1 }),
      c({ id: 3, first: '', last: 'ידידים', deals: 1 }),
      c({ id: 4, first: 'שירה', last: 'kleinman', deals: 1 }),
    ],
  });
  const batch = proposals.filter((p) => p.batchApprovable);
  assert.equal(batch.length, 2, 'only the junk-surname fixes qualify');
  for (const p of batch) {
    const f = p.proposedFields;
    const firstOut = f.firstNameHe || f.firstNameEn;
    assert.equal(firstOut, p.original.first_name, 'the identity-carrying field is untouched');
    assert.equal(p.treatment, 'import', 'a batch fix never excludes');
    assert.equal(p.validationAfter.valid, true);
  }
});

test('an English surname-only record moves into the English pair, not the Hebrew one', () => {
  const a = analyzeName({ name: 'Cohen', first_name: '', last_name: 'Cohen' });
  assert.deepEqual(a.fields, { firstNameHe: '', lastNameHe: '', firstNameEn: 'Cohen', lastNameEn: '' });
});

test('records that are not people propose EXCLUSION and are never deterministic', () => {
  for (const [label, person] of [
    ['email', { name: 'a@b.com', first_name: 'a@b.com', last_name: '' }],
    ['phone', { name: '0501234567', first_name: '0501234567', last_name: '' }],
    ['company', { name: 'בית ספר הדר', first_name: '', last_name: 'בית ספר הדר' }],
    ['ops text', { name: 'test', first_name: 'test', last_name: '' }],
    ['junk', { name: '-', first_name: '-', last_name: '' }],
  ]) {
    const a = analyzeName(person);
    assert.ok(a, `${label} must be surfaced`);
    assert.equal(a.treatment, 'exclude', `${label} → propose exclusion`);
    assert.equal(a.deterministic, false, `${label} is NEVER auto-applied — only the owner knows`);
  }
});

test('a company name never wins over a real person hiding behind it — it is only PROPOSED', () => {
  const a = analyzeName({ name: 'קרן בנק דיסקונט', first_name: 'קרן', last_name: 'בנק דיסקונט' });
  assert.ok(a.issues.includes('name_is_company'));
  assert.equal(a.deterministic, false, 'קרן may well be a real person at that bank');
});

test('Hebrew and English across the two fields is ambiguous, never guessed', () => {
  const a = analyzeName({ name: 'שירה kleinman', first_name: 'שירה', last_name: 'kleinman' });
  assert.ok(a.issues.includes('cross_script_fields'));
  assert.equal(a.deterministic, false);
  // Each part stays in ITS OWN language — nothing is transliterated or invented.
  assert.equal(a.fields.firstNameHe, 'שירה');
  assert.equal(a.fields.lastNameEn, 'kleinman');
  assert.equal(a.fields.firstNameEn, '');
});

test('a junk surname is dropped deterministically — the first name is untouched', () => {
  const a = analyzeName({ name: 'דנה -', first_name: 'דנה', last_name: '-' });
  assert.ok(a.issues.includes('junk_surname'));
  assert.equal(a.deterministic, true);
  assert.deepEqual(a.fields, { firstNameHe: 'דנה', lastNameHe: '', firstNameEn: '', lastNameEn: '' });
});

test('"New Contact" spam is never a name to clean', () => {
  const { proposals, stats } = buildNameCleanupProposals({
    contacts: [c({ id: 1, name: 'New Contact | 0501234567', first: 'New Contact', deals: 2 })],
  });
  assert.equal(stats.newContactSpamExcluded, 1);
  assert.equal(proposals.length, 0);
});

test('empty shells are surfaced but cost the owner NOTHING', () => {
  const { proposals, stats } = buildNameCleanupProposals({
    contacts: [
      c({ id: 1, first: '', last: 'לוי', deals: 3 }),   // importable → a real decision
      c({ id: 2, first: '', last: 'כהן' }),             // no history at all → never created
    ],
  });
  const byId = Object.fromEntries(proposals.map((p) => [p.legacyId, p]));
  assert.equal(byId[1].decisionRequired, true);
  assert.equal(byId[1].section, 'historical');
  assert.equal(byId[2].decisionRequired, false);
  assert.equal(byId[2].section, 'none', 'a shell is never created, so its name cannot matter');
  assert.equal(byId[2].batchApprovable, false);
  assert.equal(stats.requiresDecision, 1);
  assert.equal(stats.emptyShellIssues, 1);
});

test('sections rank by business impact — a live deal outranks closed history', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [
      c({ id: 1, first: '', last: 'היסטורי', deals: 9 }),
      c({ id: 2, first: '', last: 'חי', deals: 1, open: 1 }),
    ],
  });
  assert.equal(proposals[0].legacyId, 2);
  assert.equal(proposals[0].section, 'critical');
  assert.equal(proposals[1].section, 'historical');
});

test('only deterministic, identity-preserving cleanups are batch-approvable', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [
      c({ id: 1, first: 'אודליה', last: '-', deals: 2 }),                // junk surname → the ONLY batchable class
      c({ id: 2, first: '', last: 'לוי', deals: 2 }),                    // surname-only → person or company? owner decides
      c({ id: 3, first: '', last: 'בית ספר הדר', deals: 2 }),            // company → exclusion
      c({ id: 4, first: 'שירה', last: 'kleinman', deals: 2 }),           // cross-script
    ],
  });
  const byId = Object.fromEntries(proposals.map((p) => [p.legacyId, p]));
  assert.equal(byId[1].batchApprovable, true, 'the first name is untouched');
  assert.equal(byId[2].batchApprovable, false, 'a surname-only record may well be an organisation');
  assert.equal(byId[3].batchApprovable, false, 'an exclusion is never batched');
  assert.equal(byId[4].batchApprovable, false, 'an ambiguous split is never batched');
});

test('the owner\'s edited fields are binding, and re-validated', () => {
  const { proposals } = buildNameCleanupProposals({ contacts: [c({ id: 1, first: '', last: 'לוי', deals: 2 })] });
  const p = proposals[0];
  const draft = nameDraftFromProposal(p, null);
  assert.equal(draft.fields.firstNameHe, 'לוי');

  // The owner rewrites it entirely — their value wins.
  const edited = { treatment: 'import', fields: { firstNameHe: 'רון', lastNameHe: 'לוי', firstNameEn: 'Ron', lastNameEn: 'Levi' } };
  const r = resolveNameResult(p, edited);
  assert.equal(r.valid, true);
  assert.equal(r.displayHe, 'רון לוי');
  assert.equal(r.displayEn, 'Ron Levi');
  assert.ok(r.warnings.some((w) => /השם שונה מהמקור/.test(w)), 'a changed name is always called out');

  // The owner cannot save something GOS would reject.
  const bad = resolveNameResult(p, { treatment: 'import', fields: { firstNameHe: '', lastNameHe: 'לוי', firstNameEn: '', lastNameEn: '' } });
  assert.equal(bad.valid, false);
  assert.match(bad.problems.join(' '), /חובה שם פרטי/);
});

test('excluding a record that has deals is allowed, but warned about', () => {
  const { proposals } = buildNameCleanupProposals({ contacts: [c({ id: 1, first: '', last: 'בית ספר הדר', deals: 4 })] });
  const r = resolveNameResult(proposals[0], { treatment: 'exclude', fields: proposals[0].proposedFields });
  assert.equal(r.valid, true, 'exclusion never fails name validation');
  assert.equal(r.excluded, true);
  assert.match(r.warnings.join(' '), /4 עסקאות/);
});

// ── THE BUSINESS RULE (owner, 2026-07-16) ─────────────────────────────────────
// "This is an Organization" + zero Deals → NOT imported by default. Old
// activities/notes are not enough to justify an Organization. Deals > 0 →
// defaults to creating one. Either default is an explicit-override away — a
// business decision, never an automatic matching rule.
test('an organisation with ZERO deals defaults to NOT imported; the owner may override', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [c({ id: 1, first: '', last: 'בית ספר הדר', acts: 5, notes: 3 })], // history but no deals
  });
  const p = proposals[0];
  const draft = nameDraftFromProposal(p, null);
  assert.equal(draft.organization.create, false, 'zero deals → the default is do-not-import');

  // The default outcome: archive only, valid, no organisation.
  let r = resolveNameResult(p, { ...draft, treatment: 'organization' });
  assert.equal(r.valid, true);
  assert.equal(r.organization.create, false);

  // The explicit override is allowed — and labelled as an override of the rule.
  r = resolveNameResult(p, { ...draft, treatment: 'organization', organization: { ...draft.organization, create: true } });
  assert.equal(r.valid, true);
  assert.match(r.warnings.join(' '), /חריגה מכלל העסק/);
});

test('an organisation WITH deals defaults to being created', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [c({ id: 1, first: '', last: 'בנק יהב', deals: 4 })],
  });
  const p = proposals[0];
  const draft = nameDraftFromProposal(p, null);
  assert.equal(draft.organization.create, true, 'deals > 0 → the default is create');
  assert.equal(draft.organization.name, 'בנק יהב', 'name defaults from the record');

  const r = resolveNameResult(p, { ...draft, treatment: 'organization' });
  assert.equal(r.valid, true);
  assert.equal(r.organization.create, true);
  assert.deepEqual(r.warnings, [], 'following the rule is not a warning');

  // Choosing NOT to import despite deals is allowed but strands them — warned.
  const skip = resolveNameResult(p, { ...draft, treatment: 'organization', organization: { ...draft.organization, create: false } });
  assert.equal(skip.valid, true);
  assert.match(skip.warnings.join(' '), /4 עסקאות/);
});

test('creating an organisation requires a name — or an existing target whose key is real', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [c({ id: 1, first: '', last: 'בנק יהב', deals: 2 })],
  });
  const p = proposals[0];
  const base = nameDraftFromProposal(p, null);

  const noName = resolveNameResult(p, { ...base, treatment: 'organization', organization: { create: true, name: '', targetOrganizationKey: null } });
  assert.equal(noName.valid, false);
  assert.match(noName.problems.join(' '), /חובה שם/);

  const ctx = { orgTargetKeys: new Set(['prop:org:normName:בנק יהב']) };
  const mapped = resolveNameResult(p, { ...base, treatment: 'organization', organization: { create: true, name: '', targetOrganizationKey: 'prop:org:normName:בנק יהב', targetLabel: 'בנק יהב' } }, ctx);
  assert.equal(mapped.valid, true, 'mapping to an existing target needs no new name');

  const dangling = resolveNameResult(p, { ...base, treatment: 'organization', organization: { create: true, name: '', targetOrganizationKey: 'prop:gone' } }, ctx);
  assert.equal(dangling.valid, false);
  assert.match(dangling.problems.join(' '), /לא נמצא במרשם/);
});

test('organisation mode never creates a Contact: name/phone/email gates do not apply', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [c({ id: 1, first: '', last: 'בנק יהב', deals: 2, phones: ['not-a-phone-at-all'] })],
  });
  const p = proposals[0];
  const draft = nameDraftFromProposal(p, null);
  // As a PERSON this record is invalid twice over (no first name via empty fields +
  // junk phone). As an ORGANISATION neither gate applies.
  const r = resolveNameResult(p, { ...draft, treatment: 'organization', fields: { firstNameHe: '', lastNameHe: '', firstNameEn: '', lastNameEn: '' } });
  assert.equal(r.valid, true);
  assert.equal(r.phones, null, 'phones belong to the person flow');
  assert.deepEqual(r.emails, []);
});

test('subject keys are stable and per source contact', () => {
  assert.equal(nameSubjectKey(19834), 'name:19834');
});

test('the ORIGINAL fields are always preserved on the proposal', () => {
  const { proposals } = buildNameCleanupProposals({ contacts: [c({ id: 1, first: '', last: 'לוי', name: 'לוי', deals: 1 })] });
  const p = proposals[0];
  assert.deepEqual(p.original, { name: 'לוי', first_name: '', last_name: 'לוי' });
  assert.deepEqual(p.currentMapping, defaultFields('', 'לוי'), 'what the import would do WITHOUT cleanup');
  assert.equal(p.validationBefore.valid, false, 'and it would fail');
});
