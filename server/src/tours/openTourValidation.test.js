import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTemplatePatch,
  buildRulePatch,
  buildExceptionPatch,
  normalizeTemplateProducts,
} from './openTourValidation.js';

// The Open Tours admin API validators — the thin route delegates to these.

test('template create requires a name and validates optional scalars', () => {
  assert.equal(buildTemplatePatch({}).error, 'invalid_name');
  assert.equal(buildTemplatePatch({ nameHe: '  ' }).error, 'invalid_name');
  const ok = buildTemplatePatch({ nameHe: ' סיור גרפיטי ', tourLanguage: 'he', capacity: 30 });
  assert.equal(ok.data.nameHe, 'סיור גרפיטי');
  assert.equal(ok.data.capacity, 30);
  assert.equal(buildTemplatePatch({ nameHe: 'x', tourLanguage: 'zz' }).error, 'invalid_language');
  assert.equal(buildTemplatePatch({ nameHe: 'x', capacity: 0 }).error, 'invalid_capacity');
  assert.equal(buildTemplatePatch({ nameHe: 'x', durationHoursOverride: 99 }).error, 'invalid_duration');
});

test('template PUT is partial — name only required when provided', () => {
  const ok = buildTemplatePatch({ capacity: 12 }, { partial: true });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.data, { capacity: 12 });
  // Nullable clears: empty duration/capacity → null
  assert.equal(buildTemplatePatch({ capacity: '' }, { partial: true }).data.capacity, null);
});

test('schedule rule validates weekday, time and validity window', () => {
  assert.equal(buildRulePatch({ weekday: 7, startTime: '10:00' }).error, 'invalid_weekday');
  assert.equal(buildRulePatch({ weekday: 4, startTime: '25:00' }).error, 'invalid_time');
  assert.equal(
    buildRulePatch({ weekday: 4, startTime: '10:00', validFrom: '2026-09-01', validUntil: '2026-08-01' }).error,
    'invalid_validity_range',
  );
  const ok = buildRulePatch({ weekday: 4, startTime: '17:00', season: ' קיץ ' });
  assert.equal(ok.data.weekday, 4);
  assert.equal(ok.data.startTime, '17:00');
  assert.equal(ok.data.season, 'קיץ');
});

test('exception validates type and requires a time except for cancel', () => {
  assert.equal(buildExceptionPatch({ date: 'nope', type: 'add' }).error, 'invalid_date');
  assert.equal(buildExceptionPatch({ date: '2026-08-01', type: 'bogus' }).error, 'invalid_type');
  assert.equal(buildExceptionPatch({ date: '2026-08-01', type: 'add' }).error, 'invalid_time');
  assert.deepEqual(buildExceptionPatch({ date: '2026-08-01', type: 'cancel' }).data, {
    date: '2026-08-01',
    type: 'cancel',
    time: null,
    note: null,
  });
  assert.equal(buildExceptionPatch({ date: '2026-08-01', type: 'time_override', time: '20:00' }).data.time, '20:00');
});

test('offered products: empty rows skipped, exactly one default enforced', () => {
  assert.equal(normalizeTemplateProducts('nope').error, 'invalid_products');
  assert.equal(
    normalizeTemplateProducts([
      { productVariantId: 'v1', isDefault: true },
      { productVariantId: 'v2', isDefault: true },
    ]).error,
    'multiple_defaults',
  );
  // No default flagged → the first becomes default; blank rows dropped.
  const { rows } = normalizeTemplateProducts([
    { productVariantId: 'v1' },
    { productVariantId: '' },
    { productVariantId: 'v2' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isDefault, true);
  assert.equal(rows[1].isDefault, false);
});
