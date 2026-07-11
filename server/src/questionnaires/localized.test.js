import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLocalized,
  normalizeLocalizedInput,
  hasLanguage,
  isRtl,
} from '../../../shared/questionnaire/localized.mjs';
import { getPurpose, purposeAllowsSubject, listPurposes, registerSubjectAdapter, getSubjectAdapter } from './registry.js';

// Localized JSON maps (blueprint §11) + registries (§4–§5).

test('fallback chain: requested → default → first non-empty', () => {
  const map = { he: 'שלום', en: 'Hello' };
  assert.equal(resolveLocalized(map, 'en', 'he'), 'Hello');
  assert.equal(resolveLocalized(map, 'es', 'he'), 'שלום');
  assert.equal(resolveLocalized({ en: 'Only EN' }, 'he', 'he'), 'Only EN');
  assert.equal(resolveLocalized({ he: '  ' }, 'he', 'he'), '');
  assert.equal(resolveLocalized(null, 'he'), '');
  assert.equal(resolveLocalized('plain string', 'he'), 'plain string');
});

test('normalizeLocalizedInput: strings, maps, junk', () => {
  assert.deepEqual(normalizeLocalizedInput('שם', 'he'), { he: 'שם' });
  assert.deepEqual(normalizeLocalizedInput({ he: ' שם ', en: 'Name', zz_bad: 'x', n: 5 }), { he: 'שם', en: 'Name' });
  assert.equal(normalizeLocalizedInput('   '), null);
  assert.equal(normalizeLocalizedInput({ he: '' }), null);
  assert.equal(normalizeLocalizedInput(42), null);
});

test('hasLanguage is strict about the specific language', () => {
  assert.equal(hasLanguage({ he: 'כן' }, 'he'), true);
  assert.equal(hasLanguage({ en: 'yes' }, 'he'), false);
  assert.equal(hasLanguage(null, 'he'), false);
});

test('RTL detection', () => {
  assert.equal(isRtl('he'), true);
  assert.equal(isRtl('en'), false);
  assert.equal(isRtl('es'), false);
});

// ── registries ───────────────────────────────────────────────────────────────

test('purpose registry: tour_summary + coordination + general with correct binding rules', () => {
  assert.equal(getPurpose('tour_summary').singleton, true);
  // Coordination turned internal-only (staff fills it during the call) —
  // no public links, no customer surface.
  assert.equal(getPurpose('coordination').audience, 'staff');
  assert.equal(getPurpose('coordination').tourOperational, true);
  assert.ok(listPurposes().map((p) => p.key).includes('general'));

  assert.equal(purposeAllowsSubject('tour_summary', 'tour_event'), true);
  assert.equal(purposeAllowsSubject('tour_summary', 'booking'), false);
  assert.equal(purposeAllowsSubject('coordination', 'booking'), true);
  // unbound submissions only where the purpose opts in
  assert.equal(purposeAllowsSubject('general', null), true);
  assert.equal(purposeAllowsSubject('tour_summary', null), false);
  assert.equal(purposeAllowsSubject('nope', 'booking'), false);
});

test('subject adapter registry: registration contract', () => {
  assert.throws(() => registerSubjectAdapter('broken', {}), /must implement exists/);
  registerSubjectAdapter('test_subject', { exists: async () => true });
  assert.equal(getSubjectAdapter('test_subject').subjectType, 'test_subject');
  assert.equal(getSubjectAdapter('missing'), null);
});
