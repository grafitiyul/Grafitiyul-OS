import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPhoneRow,
  israeliDisplayValue,
  planIsraeliDisplay,
  planDuplicates,
  planForeign972,
  isCountryAuthoritative,
  normalizePhoneIntl,
} from './contactPhoneCleanup.js';

test('classifyPhoneRow separates Israeli local / Israeli intl / foreign', () => {
  assert.equal(classifyPhoneRow('050-123-4567').kind, 'israeli_local');
  assert.equal(classifyPhoneRow('0501234567').kind, 'israeli_local');
  assert.equal(classifyPhoneRow('+972501234567').kind, 'israeli_intl');
  assert.equal(classifyPhoneRow('972501234567').kind, 'israeli_intl');
  assert.equal(classifyPhoneRow('00972501234567').kind, 'israeli_intl');
  assert.equal(classifyPhoneRow('+447974905044').kind, 'foreign');
  assert.equal(classifyPhoneRow('').kind, 'empty');
});

test('a 972 prefix with an impossible Israeli length is a corruption suspect', () => {
  assert.equal(classifyPhoneRow('+972525512345678').kind, 'bad_972');
  assert.equal(classifyPhoneRow('9721234').kind, 'bad_972');
  assert.equal(classifyPhoneRow('123').kind, 'unusable');
});

test('the 972+0 legacy double prefix is already handled by the canonical normalizer', () => {
  const c = classifyPhoneRow('972050-1234567');
  assert.equal(c.intl, '972501234567');
  assert.equal(c.kind, 'israeli_intl');
});

test('israeliDisplayValue produces the local 05x form and round-trips', () => {
  assert.equal(israeliDisplayValue('+972521234567'), '052-123-4567');
  assert.equal(israeliDisplayValue('972508783355'), '050-878-3355');
  assert.equal(israeliDisplayValue('97231234567'), '03-123-4567');
  for (const shape of ['+972521234567', '972521234567', '00972521234567', '0521234567']) {
    assert.equal(normalizePhoneIntl(israeliDisplayValue(shape)), '972521234567', shape);
  }
});

test('israeliDisplayValue refuses to localize a foreign number', () => {
  assert.equal(israeliDisplayValue('+447974905044'), null);
  assert.equal(israeliDisplayValue('+972525512345678'), null);
});

test('planIsraeliDisplay preserves canonical identity exactly', () => {
  const p = planIsraeliDisplay({ value: '+972-52-123-4567' });
  assert.equal(p.action, 'reformat');
  assert.equal(p.to, '052-123-4567');
  assert.equal(normalizePhoneIntl(p.from), normalizePhoneIntl(p.to));
});

test('planIsraeliDisplay is idempotent and leaves foreign numbers alone', () => {
  assert.equal(planIsraeliDisplay({ value: '052-123-4567' }).action, 'none');
  assert.equal(planIsraeliDisplay({ value: '+44 7974905044' }).action, 'none');
});

test('duplicates are grouped by canonical identity, not string similarity', () => {
  const rows = [
    { id: 'a', value: '0501234567', isPrimary: false, sortOrder: 0, createdAt: '2024-01-01' },
    { id: 'b', value: '050-123-4567', isPrimary: true, sortOrder: 1, createdAt: '2024-02-01' },
    { id: 'c', value: '+972501234567', isPrimary: false, sortOrder: 2, createdAt: '2024-03-01' },
    { id: 'd', value: '0521111111', isPrimary: false, sortOrder: 3, createdAt: '2024-04-01' },
  ];
  const { groups, dropIds } = planDuplicates(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].intl, '972501234567');
  assert.equal(groups[0].survivor.id, 'b', 'the primary row survives');
  assert.deepEqual(dropIds.sort(), ['a', 'c']);
});

test('a non-primary survivor inherits primary status from a dropped duplicate', () => {
  const rows = [
    { id: 'a', value: '0501234567', isPrimary: false, sortOrder: 0, createdAt: '2024-01-01' },
    { id: 'b', value: '+972501234567', isPrimary: true, sortOrder: 5, createdAt: '2024-02-01' },
  ];
  const { groups } = planDuplicates(rows);
  assert.equal(groups[0].survivor.id, 'b');
  assert.equal(groups[0].patch.isPrimary, undefined, 'already primary');

  const rows2 = [
    { id: 'a', value: '0501234567', isPrimary: true, sortOrder: 9, createdAt: '2024-01-01' },
    { id: 'b', value: '+972501234567', isPrimary: false, sortOrder: 0, createdAt: '2024-02-01' },
  ];
  const g2 = planDuplicates(rows2).groups[0];
  assert.equal(g2.survivor.id, 'a', 'primary outranks sortOrder');
});

test('a label on a dropped duplicate is carried to the survivor', () => {
  const rows = [
    { id: 'a', value: '0501234567', isPrimary: true, sortOrder: 0, createdAt: '2024-01-01', label: '' },
    { id: 'b', value: '+972501234567', isPrimary: false, sortOrder: 1, createdAt: '2024-02-01', label: 'עבודה' },
  ];
  const { groups } = planDuplicates(rows);
  assert.equal(groups[0].patch.label, 'עבודה');
});

test('unnormalizable rows are never deduped against each other', () => {
  const rows = [
    { id: 'a', value: '123', isPrimary: false, sortOrder: 0, createdAt: '2024-01-01' },
    { id: 'b', value: '123', isPrimary: false, sortOrder: 1, createdAt: '2024-02-01' },
  ];
  assert.deepEqual(planDuplicates(rows).dropIds, []);
});

test('a foreign 972 corruption is repaired only with independent proof', () => {
  const row = { value: '+972525512345678' };
  const proven = planForeign972(row, new Set(['525512345678']));
  assert.equal(proven.verdict, 'proven');
  assert.equal(proven.candidate, '525512345678');
  assert.equal(normalizePhoneIntl(proven.to), '525512345678');

  const unproven = planForeign972(row, new Set());
  assert.equal(unproven.verdict, 'foreign_unknown');
  assert.equal(unproven.to, undefined, 'never written without proof');
});

test('a country is never invented from length alone', () => {
  const r = planForeign972({ value: '+9721234567890' }, new Set());
  assert.equal(r.verdict, 'foreign_unknown');
  assert.equal(r.to, undefined);
});

test('a repair is refused when stripping 972 yields another Israeli number', () => {
  // 972 + 972xxxxxxxxx — stripping gives an Israeli number, which proves
  // nothing about a foreign country.
  const r = planForeign972({ value: '972972501234567' }, new Set(['972501234567']));
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.to, undefined);
});

test('valid Israeli numbers are never treated as 972 corruption', () => {
  assert.equal(planForeign972({ value: '+972501234567' }, new Set()).verdict, 'not_applicable');
});

// ── the country-authority rule (production traps, contacts #23350/#22474/#21308)
test('only an explicit + / 00 prefix proves a country', () => {
  assert.equal(isCountryAuthoritative('+65 9145 7931'), true);
  assert.equal(isCountryAuthoritative('0044 20 3468 2356'), true);
  // These are US numbers in national form. Read as bare international digits
  // they masquerade as Singapore / Russia / India. NOT proof.
  assert.equal(isCountryAuthoritative('(650) 814-6172'), false);
  assert.equal(isCountryAuthoritative('7186440498'), false);
  assert.equal(isCountryAuthoritative('9177346364'), false);
  assert.equal(isCountryAuthoritative('06508146172'), false);
});

test('a US national-format sibling never proves a foreign country code', () => {
  // Contact #23350 in production: '(650) 814-6172' (US) alongside the corrupt
  // '+9726508146172'. A bare-digit proof rule would have written Singapore.
  const siblings = ['(650) 814-6172', '06508146172'];
  const proofs = new Set(
    siblings.filter(isCountryAuthoritative).map((s) => normalizePhoneIntl(s)).filter(Boolean),
  );
  assert.equal(proofs.size, 0, 'no sibling is country-authoritative');
  const r = planForeign972({ value: '+9726508146172' }, proofs);
  assert.equal(r.verdict, 'foreign_unknown');
  assert.equal(r.to, undefined, 'must NOT become a Singapore number');
});

test('an explicitly international sibling does prove the country', () => {
  // Contact #19278 in production: '+65 9145 7931' proves the Singapore number.
  const proofs = new Set(
    ['+65 9145 7931', '06591457931']
      .filter(isCountryAuthoritative)
      .map((s) => normalizePhoneIntl(s))
      .filter(Boolean),
  );
  assert.deepEqual([...proofs], ['6591457931']);
  const r = planForeign972({ value: '+9726591457931' }, proofs);
  assert.equal(r.verdict, 'proven');
  assert.equal(normalizePhoneIntl(r.to), '6591457931');
});
