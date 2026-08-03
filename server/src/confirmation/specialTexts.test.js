// Special-text category registry tests. Pure: no DB.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIAL_TEXT_CATEGORIES,
  SPECIAL_TEXT_CATEGORY_KEYS,
  getSpecialTextCategory,
  isValidSpecialTextCategory,
} from './specialTexts.js';
import { AUTO_SECTION_KEYS } from './sections.js';
import { CONFIRMATION_CONTENT_TYPES } from '../shared-content/sharedContentTypes.js';

test('cancellation_policy is the first category and every entry is complete', () => {
  assert.equal(SPECIAL_TEXT_CATEGORIES[0].key, 'cancellation_policy');
  for (const c of SPECIAL_TEXT_CATEGORIES) {
    assert.ok(c.key && c.labelHe && c.labelEn, c.key);
  }
});

test('category lookup + validation', () => {
  assert.equal(getSpecialTextCategory('cancellation_policy').labelHe, 'מדיניות ביטול');
  assert.equal(getSpecialTextCategory('nope'), null);
  assert.equal(isValidSpecialTextCategory('cancellation_policy'), true);
  assert.equal(isValidSpecialTextCategory('weather'), false); // future = registry entry
});

test('the model is CATEGORY-generic: adding a future category needs no new key shape', () => {
  // Guard against a cancellation-only design creeping back in: the keys are
  // plain strings on ONE model, not a dedicated per-category vocabulary.
  for (const key of SPECIAL_TEXT_CATEGORY_KEYS) {
    assert.match(key, /^[a-z][a-z0-9_]*$/);
  }
});

test('cancellation is an AUTO email section, not a Shared-Content block type', () => {
  assert.ok(AUTO_SECTION_KEYS.includes('cancellation_policy'));
  assert.equal(
    CONFIRMATION_CONTENT_TYPES.includes('confirmation_cancellation_policy'),
    false,
    'templates must not be able to add cancellation library blocks any more',
  );
});
