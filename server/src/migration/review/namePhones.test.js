import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, suggestCountry, normalizeForCountry, defaultPhoneRow, resolvePhoneRow } from './namePhones.js';
import { normalizePhoneIntl } from '../../whatsapp/phone.js';
import { nameDraftFromProposal, resolveNameResult, nameDecisionFromDraft, buildNameCleanupProposals } from './nameCleanup.js';

// All numbers here are SYNTHETIC.

test("the owner's spec examples, verbatim", () => {
  // Israel + 050-1234567 → +972501234567 (comparison value; stored without '+').
  assert.equal(normalizeForCountry('050-1234567', 'IL').normalized, '972501234567');
  // United Kingdom + 020… → normalized under the selected country (trunk 0 dropped).
  assert.equal(normalizeForCountry('020 7946 0958', 'GB').normalized, '442079460958');
  // Unknown country → original preserved, explicit confirmation required.
  const other = normalizeForCountry('12345 678', 'OTHER');
  assert.equal(other.requiresConfirmation, true);
  assert.equal(other.problems.length, 0, 'not an error — a confirmation gate');
});

test('normalization is BYTE-COMPATIBLE with the runtime SSOT for Israeli numbers', () => {
  // WhatsApp matching, contact dedup and this flow must share one notion of
  // "same number" — normalizePhoneIntl (whatsapp/phone.js) is that notion.
  for (const raw of ['050-123-4567', '+972 50 1234567', '0501234567', '03-5551234']) {
    assert.equal(normalizeForCountry(raw, 'IL').normalized, normalizePhoneIntl(raw), raw);
  }
});

test('a number that states one country is NEVER silently rewritten to another', () => {
  const r = normalizeForCountry('+44 20 7946 0958', 'IL');
  assert.equal(r.normalized, null);
  assert.match(r.problems.join(' '), /בריטניה/, 'the mismatch names the actual country');
  // And the reverse: +972 under GB.
  assert.equal(normalizeForCountry('+972501234567', 'GB').normalized, null);
});

test('suggestions come only from what the number itself states', () => {
  assert.equal(suggestCountry('050-1234567'), 'IL', 'Israeli local form states itself');
  assert.equal(suggestCountry('+44 20 7946 0958'), 'GB', 'an explicit +44 states itself');
  assert.equal(suggestCountry('0044 20 7946 0958'), 'GB', '00 prefix too');
  assert.equal(suggestCountry('972501234567'), 'IL', 'bare international digits');
  assert.equal(suggestCountry('12345'), 'OTHER', 'anything else is never guessed');
});

test('validation errors are explicit: bad length, double trunk zero, too long', () => {
  assert.match(normalizeForCountry('050-123', 'IL').problems.join(' '), /אורך לא תקין/);
  assert.match(normalizeForCountry('+972 050 1234567', 'IL').problems.join(' '), /0 מיותרת/);
  assert.match(normalizeForCountry('+9725012345678901', 'IL').problems.join(' '), /אורך לא תקין|ארוך מדי/);
});

test('an OTHER-country phone is importable only after explicit confirmation', () => {
  const row = { ...defaultPhoneRow('12345 678', 0), country: 'OTHER' };
  const un = resolvePhoneRow(row);
  assert.equal(un.importable, false);
  assert.match(un.problems.join(' '), /אישור מפורש/);
  const ok = resolvePhoneRow({ ...row, confirmUnverified: true });
  assert.equal(ok.importable, true);
  assert.equal(ok.value, '12345 678', 'the original value is preserved, not normalized');
});

test('a removed phone is skipped entirely — no validation, no import', () => {
  const r = resolvePhoneRow({ ...defaultPhoneRow('junk', 0), remove: true });
  assert.equal(r.importable, false);
  assert.deepEqual(r.problems, []);
});

// ── the resolver gates ────────────────────────────────────────────────────────
const proposal = (phones = ['050-1234567'], emails = ['a@b.com']) => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [{
      legacyId: 7, name: 'לוי', firstName: '', lastName: 'לוי',
      phones, emails, orgId: null, orgName: null,
      dealCount: 2, openDealCount: 0, futureTourDeals: 0, wonRecentDealCount: 0,
      activityCount: 0, noteCount: 0, fileCount: 0, participantCount: 0,
    }],
  });
  return proposals[0];
};

test('approval is blocked on: no first name, invalid phone, duplicate normalized, conflict', () => {
  const p = proposal(['050-1234567', '+972-50-1234567']); // same number twice
  const draft = nameDraftFromProposal(p, null);

  // Duplicate normalized phones.
  let r = resolveNameResult(p, { ...draft, fields: { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' } });
  assert.equal(r.valid, false);
  assert.match(r.problems.join(' '), /פעמיים/);

  // Removing one resolves it.
  const oneRemoved = draft.phones.map((x, i) => (i === 1 ? { ...x, remove: true } : x));
  r = resolveNameResult(p, { treatment: 'import', fields: { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' }, phones: oneRemoved });
  assert.equal(r.valid, true);
  assert.match(r.warnings.join(' '), /נשארים בצילום ובארכיון/);

  // Both first names empty → blocked.
  r = resolveNameResult(p, { treatment: 'import', fields: { firstNameHe: '', lastNameHe: 'לוי', firstNameEn: '', lastNameEn: '' }, phones: oneRemoved });
  assert.equal(r.valid, false);

  // A phone claimed by ANOTHER decision blocks; the same person's own claim never does.
  const claims = new Map([['972501234567', { label: 'איחוד כפילויות: דנה', ownerIds: new Set([99]) }]]);
  const ctx = { claimedPhones: { get: (n) => { const c = claims.get(n); return c && !c.ownerIds.has(7) ? c : undefined; } } };
  r = resolveNameResult(p, { treatment: 'import', fields: { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' }, phones: oneRemoved }, ctx);
  assert.equal(r.valid, false);
  assert.match(r.problems.join(' '), /כבר שויך להחלטה אחרת/);
  claims.get('972501234567').ownerIds = new Set([7]); // now it is the same person
  r = resolveNameResult(p, { treatment: 'import', fields: { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' }, phones: oneRemoved }, ctx);
  assert.equal(r.valid, true, 'a person never conflicts with their own claim');
});

test('at most one preferred phone', () => {
  const p = proposal(['050-1234567', '052-7654321']);
  const draft = nameDraftFromProposal(p, null);
  const both = draft.phones.map((x) => ({ ...x, isPrimary: true }));
  const r = resolveNameResult(p, { treatment: 'import', fields: { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' }, phones: both });
  assert.equal(r.valid, false);
  assert.match(r.problems.join(' '), /מועדף/);
});

test('the stored decision carries original + country + edited value + normalized, per phone', () => {
  const p = proposal(['050-1234567']);
  const draft = nameDraftFromProposal(p, null);
  draft.fields = { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' };
  draft.phones[0].value = '050-999-8877'; // the owner corrected the number
  const d = nameDecisionFromDraft(p, draft);
  assert.deepEqual(
    { original: d.phones[0].original, country: d.phones[0].country, value: d.phones[0].value, normalized: d.phones[0].normalized },
    { original: '050-1234567', country: 'IL', value: '050-999-8877', normalized: '972509998877' },
  );
  assert.equal(d.result.valid, true);
});

test('a name-only decision (the deterministic batch) records phones as NOT EDITED', () => {
  const p = proposal(['050-1234567']);
  const d = nameDecisionFromDraft(p, { treatment: 'import', fields: { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' } });
  assert.equal(d.phones, null, 'null = import the snapshot originals untouched');
  assert.equal(d.result.valid, true, 'phone gates apply only when phones are edited');
});

test('effective emails come from the identity correction, not re-derived', () => {
  const p = proposal(['050-1234567'], ['keep@x.com', 'wrong@x.com']);
  const draft = nameDraftFromProposal(p, null);
  draft.fields = { firstNameHe: 'לוי', lastNameHe: '', firstNameEn: '', lastNameEn: '' };
  const r = resolveNameResult(p, draft, { identityEdit: { removeEmails: ['wrong@x.com'], addEmails: [] } });
  assert.deepEqual(r.emails, ['keep@x.com']);
});

test('the country registry has unique codes and OTHER last', () => {
  assert.equal(new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length);
  assert.equal(COUNTRIES.at(-1).code, 'OTHER');
});
