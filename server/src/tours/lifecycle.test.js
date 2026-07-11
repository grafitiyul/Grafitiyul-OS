import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tourQuestionnairesLocked,
  TOUR_QUESTIONNAIRE_LOCK_GRACE_MS,
} from './lifecycle.js';
import { tourEndMs } from './guidePortal/dto.js';

// Fixed clock — every case computes "now" relative to the tour's end so the
// tests are independent of the machine timezone (tourEndMs parses local time).

const TOUR = {
  status: 'scheduled',
  date: '2026-07-01',
  startTime: '10:00',
  productVariant: { durationHours: 2 },
};
const END = tourEndMs(TOUR);

test('scheduled tour before its end is not locked', () => {
  assert.equal(tourQuestionnairesLocked(TOUR, END - 60_000), false);
});

test('scheduled tour inside the grace window stays unlocked (summary is filled after the tour)', () => {
  assert.equal(tourQuestionnairesLocked(TOUR, END + 24 * 60 * 60 * 1000), false);
  assert.equal(tourQuestionnairesLocked(TOUR, END + TOUR_QUESTIONNAIRE_LOCK_GRACE_MS), false);
});

test('scheduled tour past the grace window is locked', () => {
  assert.equal(
    tourQuestionnairesLocked(TOUR, END + TOUR_QUESTIONNAIRE_LOCK_GRACE_MS + 60_000),
    true,
  );
});

test('terminal statuses lock immediately regardless of date', () => {
  const future = END - 10 * 24 * 60 * 60 * 1000;
  assert.equal(tourQuestionnairesLocked({ ...TOUR, status: 'completed' }, future), true);
  assert.equal(tourQuestionnairesLocked({ ...TOUR, status: 'cancelled' }, future), true);
});

test('missing tour or unparsable date never locks', () => {
  assert.equal(tourQuestionnairesLocked(null, END), false);
  assert.equal(tourQuestionnairesLocked({ status: 'scheduled', date: '', startTime: '' }, END), false);
});

test('duration falls back to the default when the variant has none', () => {
  const noVariant = { ...TOUR, productVariant: null };
  const end = tourEndMs(noVariant);
  assert.equal(Number.isNaN(end), false);
  assert.equal(tourQuestionnairesLocked(noVariant, end + TOUR_QUESTIONNAIRE_LOCK_GRACE_MS - 1), false);
  assert.equal(tourQuestionnairesLocked(noVariant, end + TOUR_QUESTIONNAIRE_LOCK_GRACE_MS + 1), true);
});
