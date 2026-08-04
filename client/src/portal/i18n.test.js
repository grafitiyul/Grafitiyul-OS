import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PORTAL_LANGUAGES,
  DEFAULT_PORTAL_LANGUAGE,
  normalizePortalLanguage,
  portalDir,
  portalStrings,
} from './i18n.js';

// THE guard on the portal's language contract. The failure mode this prevents
// is the one the whole architecture exists to rule out: a string added to one
// language and forgotten in the other, so an English guide meets a Hebrew
// button in the middle of an otherwise-English screen.
//
// It is a STRUCTURAL check — it compares the shape of the two trees, so it
// catches every future string automatically without anyone remembering to add
// a test for it.

// Every leaf path in a string tree, with its value TYPE (string vs function —
// a plural/interpolating entry must stay callable in both languages).
function shape(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) out.set(path, `array:${value.length}`);
    else if (value && typeof value === 'object') shape(value, path, out);
    else out.set(path, typeof value);
  }
  return out;
}

test('every portal string exists in BOTH languages, with the same shape', () => {
  const he = shape(portalStrings('he'));
  const en = shape(portalStrings('en'));

  const missingInEn = [...he.keys()].filter((k) => !en.has(k));
  const missingInHe = [...en.keys()].filter((k) => !he.has(k));
  assert.deepEqual(missingInEn, [], `keys missing from the English registry: ${missingInEn}`);
  assert.deepEqual(missingInHe, [], `keys missing from the Hebrew registry: ${missingInHe}`);

  // Same TYPE per key: a counted/pluralised entry is a function in one language
  // and must be a function in the other, or the call site crashes.
  const typeMismatches = [...he.entries()]
    .filter(([k, v]) => en.get(k) !== v)
    .map(([k, v]) => `${k}: he=${v} en=${en.get(k)}`);
  assert.deepEqual(typeMismatches, [], `type mismatches: ${typeMismatches}`);
});

// Deliberately-empty entries, each with a reason. An empty string is normally a
// forgotten translation, so every exemption has to be argued for here.
const INTENTIONALLY_EMPTY = new Set([
  // Hebrew names a weekday as "יום שלישי"; English says "Tuesday" with no
  // leading word. The prefix is empty by design, not unfilled.
  'en.dates.dayPrefix',
]);

test('no string is empty in either language', () => {
  for (const lang of PORTAL_LANGUAGES) {
    for (const [path, type] of shape(portalStrings(lang))) {
      if (type !== 'string') continue;
      if (INTENTIONALLY_EMPTY.has(`${lang}.${path}`)) continue;
      const value = path.split('.').reduce((n, k) => n[k], portalStrings(lang));
      assert.ok(value.trim() !== '', `${lang}.${path} is empty`);
    }
  }
});

test('counted strings render for 0 / 1 / many in both languages', () => {
  for (const lang of PORTAL_LANGUAGES) {
    const t = portalStrings(lang);
    for (const n of [0, 1, 5]) {
      assert.ok(t.participants.many(n).includes(String(n)));
      assert.ok(t.tours.countTours(n).includes(String(n)));
      assert.ok(t.procedures.correctionsRequired(n).length > 0);
      assert.ok(t.pay.waitingMany(n).includes(String(n)));
    }
    assert.ok(t.participants.one.length > 0);
  }
});

test('direction follows the language — Hebrew RTL, English LTR', () => {
  assert.equal(portalDir('he'), 'rtl');
  assert.equal(portalDir('en'), 'ltr');
  // Unknown/absent → the portal default, never a browser guess.
  assert.equal(portalDir(undefined), portalDir(DEFAULT_PORTAL_LANGUAGE));
  assert.equal(portalDir('fr'), 'rtl');
});

test('language normalization is closed: anything unsupported resolves to the default', () => {
  assert.equal(normalizePortalLanguage('en'), 'en');
  assert.equal(normalizePortalLanguage('EN'), 'en');
  assert.equal(normalizePortalLanguage(' he '), 'he');
  for (const bad of [null, undefined, '', 'fr', 'es', 42, {}]) {
    assert.equal(normalizePortalLanguage(bad), DEFAULT_PORTAL_LANGUAGE);
  }
  // …and the string tree never comes back undefined for a bad input.
  assert.ok(portalStrings('zz').shell.greeting);
});

// The registry is CHROME only. Business data (product names, cities, customer
// names, payroll components, training content) is resolved from its own
// bilingual columns on the server — putting any of it here would be
// translation-in-code, which this project deliberately does not do.
test('the registry declares only the languages the staff field supports', () => {
  assert.deepEqual(PORTAL_LANGUAGES, ['he', 'en']);
  assert.equal(DEFAULT_PORTAL_LANGUAGE, 'he');
});
