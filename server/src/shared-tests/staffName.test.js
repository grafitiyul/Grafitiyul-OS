import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staffName, staffFirstName, staffLanguage, splitLegacyName, DEFAULT_STAFF_LANGUAGE,
} from '../../../shared/staffName.mjs';

// One resolver for staff names in both languages. The rule that matters: each
// language uses ITS OWN name — "Hi יואב" reads as a bug, and so does "שלום Yoav".

test('each language uses its own name when both exist', () => {
  const p = { profile: { firstNameHe: 'יואב', lastNameHe: 'כהן', firstNameEn: 'Yoav', lastNameEn: 'Cohen' } };
  assert.equal(staffName(p, 'he'), 'יואב כהן');
  assert.equal(staffName(p, 'en'), 'Yoav Cohen');
  assert.equal(staffFirstName(p, 'he'), 'יואב');
  assert.equal(staffFirstName(p, 'en'), 'Yoav');
});

test('a missing translation falls back to the other language, never to nothing', () => {
  // A name in the wrong language still beats a blank where a name belongs.
  const heOnly = { profile: { firstNameHe: 'מיכל', lastNameHe: 'ברק' } };
  assert.equal(staffName(heOnly, 'en'), 'מיכל ברק');
  const enOnly = { profile: { firstNameEn: 'Dana', lastNameEn: 'Levi' } };
  assert.equal(staffName(enOnly, 'he'), 'Dana Levi');
});

test('the legacy displayName is the last resort', () => {
  // Until a person has explicit fields, the recruitment-synced single string is
  // still what we have.
  const legacy = { displayName: 'נועה בר', profile: {} };
  assert.equal(staffName(legacy, 'he'), 'נועה בר');
  assert.equal(staffFirstName(legacy, 'he'), 'נועה');
});

test('explicit fields beat the legacy displayName', () => {
  // This is the whole point of moving identity to PersonProfile: a recruitment
  // sync rewriting displayName must not change what GOS shows.
  const p = { displayName: 'שם ישן מהגיוס', profile: { firstNameHe: 'יואב', lastNameHe: 'כהן' } };
  assert.equal(staffName(p, 'he'), 'יואב כהן');
});

test('a flattened DTO works as well as a nested profile', () => {
  assert.equal(staffName({ firstNameHe: 'רון', lastNameHe: 'לוי' }, 'he'), 'רון לוי');
});

test('a partial name does not produce stray whitespace', () => {
  assert.equal(staffName({ profile: { firstNameHe: 'יואב' } }, 'he'), 'יואב');
  assert.equal(staffName({ profile: { lastNameHe: 'כהן' } }, 'he'), 'כהן');
});

test('language resolution defaults to Hebrew for anything unrecognised', () => {
  assert.equal(staffLanguage({ profile: { preferredLanguage: 'en' } }), 'en');
  assert.equal(staffLanguage({ profile: { preferredLanguage: 'he' } }), 'he');
  assert.equal(staffLanguage({ profile: {} }), DEFAULT_STAFF_LANGUAGE);
  assert.equal(staffLanguage({ profile: { preferredLanguage: 'fr' } }), 'he');
  assert.equal(staffLanguage(null), 'he');
});

test('the legacy split takes the first token as the first name', () => {
  assert.deepEqual(splitLegacyName('יואב כהן'), { first: 'יואב', last: 'כהן' });
  // Compound surnames stay whole on the surname side.
  assert.deepEqual(splitLegacyName('דנה בן גוריון'), { first: 'דנה', last: 'בן גוריון' });
  assert.deepEqual(splitLegacyName('מדונה'), { first: 'מדונה', last: null });
  assert.deepEqual(splitLegacyName('   '), { first: null, last: null });
  assert.deepEqual(splitLegacyName(null), { first: null, last: null });
});

test('an empty person never throws', () => {
  assert.equal(staffName(null), '');
  assert.equal(staffFirstName(undefined), '');
  assert.equal(staffName({}), '');
});
