// The ONE language decision of the dispatcher (reportLanguage) — customer,
// per-person guide, and group-destination manager reports all resolve here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { reportLanguage } from './dispatch.js';

const tourWithGuides = (lang) => ({
  tour: { assignments: [{ role: 'guide', personRef: { profile: { preferredLanguage: lang } } }] },
});

test('a customer report always follows the customer — toggles are irrelevant', () => {
  const r = { audience: 'customer' };
  assert.equal(reportLanguage(r, { sendInGuideLanguage: true }, { preferredLanguage: 'en' }, {}), 'en');
  assert.equal(reportLanguage(r, null, { preferredLanguage: 'en' }, {}), 'en');
  assert.equal(reportLanguage(r, null, {}, {}), 'he');
});

test('checkbox off → Hebrew, whatever anyone prefers', () => {
  assert.equal(reportLanguage({ audience: 'guides' }, null, { preferredLanguage: 'en' }, {}), 'he');
  assert.equal(reportLanguage({}, { sendInGuideLanguage: false }, null, tourWithGuides('en')), 'he');
});

test('checkbox on + a personal recipient → that person\'s own language', () => {
  const cfg = { sendInGuideLanguage: true };
  assert.equal(reportLanguage({ audience: 'guides' }, cfg, { preferredLanguage: 'en' }, {}), 'en');
  assert.equal(reportLanguage({ audience: 'guides' }, cfg, { preferredLanguage: null }, {}), 'he');
});

test('checkbox on + group destination → the EVENT\'s assigned guides decide', () => {
  const cfg = { sendInGuideLanguage: true };
  assert.equal(reportLanguage({}, cfg, null, tourWithGuides('en')), 'en');
  assert.equal(reportLanguage({}, cfg, null, tourWithGuides('he')), 'he');
  assert.equal(reportLanguage({}, cfg, null, { tour: null }), 'he', 'no tour in context → Hebrew');
  assert.equal(reportLanguage({}, cfg, null, {}), 'he');
});
