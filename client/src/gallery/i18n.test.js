import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_LANGUAGES,
  MEDIA_STRINGS_EN,
  MEDIA_STRINGS_HE,
  mediaDir,
  mediaStrings,
  normalizeMediaLanguage,
} from './i18n.js';

// The guard that keeps the product from shipping half-translated: the two
// language trees must stay structurally identical, and no value may be a
// leftover from the other language.

function shape(obj, path = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...shape(v, p));
    else out.push(`${p}:${typeof v}`);
  }
  return out.sort();
}

test('Hebrew and English define exactly the same keys, with the same types', () => {
  const he = shape(MEDIA_STRINGS_HE);
  const en = shape(MEDIA_STRINGS_EN);
  const missingInEn = he.filter((k) => !en.includes(k));
  const missingInHe = en.filter((k) => !he.includes(k));
  assert.deepEqual(missingInEn, [], 'keys present in Hebrew but missing/mistyped in English');
  assert.deepEqual(missingInHe, [], 'keys present in English but missing/mistyped in Hebrew');
});

const HEBREW = /[֐-׿]/;
const LATIN = /[A-Za-z]/;

test('no English string is left in Hebrew', () => {
  const offenders = [];
  const walk = (obj, path = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') walk(v, p);
      else if (typeof v === 'string' && HEBREW.test(v)) offenders.push(p);
    }
  };
  walk(MEDIA_STRINGS_EN);
  // The language SWITCH deliberately shows the other language's own name, and
  // the Hebrew brand name is a proper noun.
  assert.deepEqual(offenders, ['common.switchLanguage']);
});

test('no Hebrew string is accidentally left untranslated in English', () => {
  // Every Hebrew value must contain Hebrew characters — a Latin-only value
  // would mean an English string was pasted into the Hebrew tree.
  const offenders = [];
  const walk = (obj, path = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') walk(v, p);
      else if (typeof v === 'string' && LATIN.test(v) && !HEBREW.test(v)) offenders.push(p);
    }
  };
  walk(MEDIA_STRINGS_HE);
  // Allowed: the switch shows 'English', and ZIP is a brand/format token.
  assert.deepEqual(offenders, ['common.switchLanguage']);
});

test('interpolating strings are functions in BOTH languages and interpolate', () => {
  for (const lang of MEDIA_LANGUAGES) {
    const t = mediaStrings(lang);
    assert.equal(typeof t.gallery.itemCount, 'function', lang);
    assert.match(t.gallery.itemCount(7), /7/, lang);
    assert.match(t.uploadQueue.doneOf(3, 9), /3/, lang);
    assert.match(t.uploadQueue.doneOf(3, 9), /9/, lang);
    assert.match(t.uploadErrors.storageRejected('418'), /418/, lang);
  }
});

test('direction follows the language, so wording and layout cannot disagree', () => {
  assert.equal(mediaDir('he'), 'rtl');
  assert.equal(mediaDir('en'), 'ltr');
});

test('an unknown or missing language falls back to Hebrew, never to blank', () => {
  for (const bad of [null, undefined, '', 'klingon', 'fr', 42]) {
    assert.equal(normalizeMediaLanguage(bad), 'he');
    assert.ok(mediaStrings(bad).gallery.emptyTitle.length > 0);
  }
  assert.equal(normalizeMediaLanguage('EN'), 'en');
  assert.equal(normalizeMediaLanguage(' en '), 'en');
});

test('no registry value is empty — an empty string renders as a missing label', () => {
  const empties = [];
  const walk = (obj, path = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') walk(v, p);
      else if (typeof v === 'string' && v.trim() === '') empties.push(p);
    }
  };
  walk(MEDIA_STRINGS_HE);
  walk(MEDIA_STRINGS_EN);
  assert.deepEqual(empties, []);
});

test('every upload failure code maps to a sentence in both languages', async () => {
  const { uploadErrorLabel } = await import('./uploadErrors.js');
  const CODES = [
    'unsupported_type', 'file_too_large', 'invalid_size', 'network_error', 'aborted',
    'object_missing', 'invalid_content', 'no_parts_uploaded', 'upload_not_found',
    'not_pending', 'tour_cancelled', 'uploads_disabled', 'gallery_archived',
    'r2_not_configured', 'too_many_files_per_call', 'not_allowed', 'not_found',
    'no_files', 'rejected', 'internal_error',
  ];
  for (const lang of MEDIA_LANGUAGES) {
    const t = mediaStrings(lang);
    for (const code of CODES) {
      const label = uploadErrorLabel(code, t);
      assert.ok(label && label.length > 3, `${lang}/${code} has no readable label`);
      assert.ok(!label.includes('_'), `${lang}/${code} leaked a raw code: ${label}`);
    }
  }
});
