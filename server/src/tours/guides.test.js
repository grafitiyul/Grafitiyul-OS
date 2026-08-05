// The tour-wide guide language rule (guidesPreferredLanguage) — what decides
// the language of ONE shared report about a tour when 'שלח בשפת המדריך' is on
// for a group-destination manager report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { notifiableGuides, guidesPreferredLanguage } from './guides.js';

const a = (role, preferredLanguage) => ({
  role,
  personRef: preferredLanguage === undefined
    ? null
    : { profile: preferredLanguage === null ? null : { preferredLanguage } },
});

test('nobody assigned → null, so callers fall back to Hebrew', () => {
  assert.equal(guidesPreferredLanguage([]), null);
  assert.equal(guidesPreferredLanguage(), null);
  // Assistants alone are not guides of the tour.
  assert.equal(guidesPreferredLanguage([a('assistant', 'en')]), null);
});

test('English only when EVERY notifiable guide prefers English', () => {
  assert.equal(guidesPreferredLanguage([a('guide', 'en')]), 'en');
  assert.equal(guidesPreferredLanguage([a('guide', 'en'), a('guide', 'en')]), 'en');
  assert.equal(guidesPreferredLanguage([a('guide', 'en'), a('guide', 'he')]), 'he');
});

test('no language configured → the canonical Hebrew fallback, never a guess', () => {
  assert.equal(guidesPreferredLanguage([a('guide', null)]), 'he');
  assert.equal(guidesPreferredLanguage([a('guide')]), 'he', 'no linked person at all');
});

test('lead guides own the decision when any exist — the notifiableGuides rule', () => {
  // The lead is English-speaking; the extra guide is Hebrew-speaking but not
  // notifiable when a lead exists, so the report follows the lead.
  assert.equal(guidesPreferredLanguage([a('lead_guide', 'en'), a('guide', 'he')]), 'en');
  assert.deepEqual(
    notifiableGuides([a('lead_guide', 'en'), a('guide', 'he')]).map((g) => g.role),
    ['lead_guide'],
  );
  // An assistant's language never matters.
  assert.equal(guidesPreferredLanguage([a('guide', 'en'), a('assistant', 'he')]), 'en');
});
