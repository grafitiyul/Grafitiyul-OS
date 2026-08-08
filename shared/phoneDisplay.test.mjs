import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPhoneDisplay,
  phoneTelHref,
  phoneCountryFromIntl,
  countryFlag,
  normalizePhoneIntl,
} from './phone.mjs';

// A guide holding a phone before a tour needs a number they can READ and TAP.
// These tests pin what each surface actually shows.

// ── The #27151 case, end to end ──────────────────────────────────────────────

test('the corrected French number reads as a French number', () => {
  const stored = '+33669129785';
  assert.equal(formatPhoneDisplay(stored), '+33 6 69 12 97 85');
  assert.equal(phoneTelHref(stored), '+33669129785');
  assert.equal(phoneCountryFromIntl(normalizePhoneIntl(stored)), 'FR');
  assert.equal(countryFlag('FR'), '🇫🇷');
});

test('the number is never rendered as if it were Israeli', () => {
  for (const v of ['+33669129785', '33669129785', '0669129785']) {
    const shown = formatPhoneDisplay(v);
    assert.ok(!shown.startsWith('05'), `${v} must not read as an Israeli mobile`);
    assert.ok(!shown.includes('+972'), `${v} must not read as +972`);
  }
});

// ── Israeli numbers read the way an Israeli reads them ───────────────────────

test('Israeli numbers are shown EXACTLY as stored — never re-styled', () => {
  // The default case. Re-grouping thousands of existing numbers to satisfy a
  // foreign-number fix would be a change nobody asked for.
  assert.equal(formatPhoneDisplay('0501234567'), '0501234567');
  assert.equal(formatPhoneDisplay('050-123-4567'), '050-123-4567');
  assert.equal(formatPhoneDisplay('031234567'), '031234567');
  // …but they still DIAL as E.164, which is what a tel: link needs.
  assert.equal(phoneTelHref('0501234567'), '+972501234567');
  assert.equal(phoneTelHref('050-123-4567'), '+972501234567');
});

test('an Israeli number stored in international form reads as local', () => {
  // The only Israeli reformatting that happens: +972… → 0…, because a guide
  // reads the local form.
  assert.equal(formatPhoneDisplay('972501234567'), '0501234567');
  assert.equal(formatPhoneDisplay('+972501234567'), '0501234567');
});

test('an Israeli number never gets a flag (it is the default, not an exception)', () => {
  assert.equal(phoneCountryFromIntl('972501234567'), 'IL');
  // The card only flags FOREIGN numbers — asserted by the card itself; here we
  // only pin that IL is correctly identified so that rule can be applied.
});

// ── Un-placeable numbers are shown exactly as stored ─────────────────────────

test('a number GOS cannot place is displayed verbatim — never dressed up', () => {
  // The pre-correction state: a real number GOS has no country for.
  assert.equal(formatPhoneDisplay('0669129785'), '0669129785');
  assert.equal(phoneTelHref('0669129785'), '0669129785');
  assert.equal(normalizePhoneIntl('0669129785'), null);
});

test('junk stays junk rather than becoming a plausible number', () => {
  assert.equal(formatPhoneDisplay('123'), '123');
  assert.equal(formatPhoneDisplay('לא ידוע'), 'לא ידוע');
  assert.equal(formatPhoneDisplay(''), null);
  assert.equal(formatPhoneDisplay(null), null);
});

// ── Other countries ──────────────────────────────────────────────────────────

test('foreign numbers are grouped ONLY where the convention is verified', () => {
  // France is the one verified convention (the #27151 number itself).
  assert.equal(formatPhoneDisplay('33669129785'), '+33 6 69 12 97 85');
  // Everything else renders "+CC national" — unambiguous, and never a grouping
  // GOS made up. This is deliberate, not a gap.
  assert.equal(formatPhoneDisplay('442071234567'), '+44 2071234567');
  assert.equal(formatPhoneDisplay('35311234567'), '+353 11234567');
  // An ambiguous dial code has no country at all, so it stays one block.
  assert.equal(formatPhoneDisplay('12125551234'), '+12125551234');
});

test('an ambiguous dial code yields no country, and therefore no flag', () => {
  // +1 is both the US and Canada — a flag that might be wrong is worse than none.
  assert.equal(phoneCountryFromIntl('12125551234'), null);
  assert.equal(countryFlag(null), null);
});

test('the longest dial code wins', () => {
  assert.equal(phoneCountryFromIntl('351912345678'), 'PT'); // not '35'
  assert.equal(phoneCountryFromIntl('972501234567'), 'IL'); // not '97'
});

test('countryFlag only accepts a real alpha-2 code', () => {
  assert.equal(countryFlag('FR'), '🇫🇷');
  assert.equal(countryFlag('il'), '🇮🇱');
  assert.equal(countryFlag('FRA'), null);
  assert.equal(countryFlag(''), null);
});

// ── Country-aware normalization: the rule this all rests on ──────────────────

test('a DECLARED country resolves a national-format number', () => {
  assert.equal(normalizePhoneIntl('0669129785', { country: 'FR' }), '33669129785');
  assert.equal(normalizePhoneIntl('06 69 12 97 85', { country: 'FR' }), '33669129785');
  assert.equal(normalizePhoneIntl('0501234567', { country: 'IL' }), '972501234567');
});

test('NO declared country means no foreign guess — the conservative rule holds', () => {
  assert.equal(normalizePhoneIntl('0669129785'), null);
  assert.equal(normalizePhoneIntl('0669129785', { country: '' }), null);
  assert.equal(normalizePhoneIntl('0669129785', { country: null }), null);
  // An unknown country code is not permission to invent one.
  assert.equal(normalizePhoneIntl('0669129785', { country: 'ZZ' }), null);
});

test('a declared country never breaks a valid Israeli number', () => {
  // The overwhelming case: Israeli numbers resolve with or without a hint.
  assert.equal(normalizePhoneIntl('0541234567'), '972541234567');
  assert.equal(normalizePhoneIntl('0541234567', { country: 'IL' }), '972541234567');
  // Even a wrong hint loses to a genuinely valid Israeli subscriber number.
  assert.equal(normalizePhoneIntl('0541234567', { country: 'FR' }), '972541234567');
});

test('Italy keeps its trunk zero; France drops it', () => {
  assert.equal(normalizePhoneIntl('0669129785', { country: 'FR' }), '33669129785');
  assert.equal(normalizePhoneIntl('0212345678', { country: 'IT' }), '390212345678');
});
