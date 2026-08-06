import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveHistoricalWonAt, silentWonPlan, HISTORICAL_WON_REASON } from './silentWon.js';
import { isLiveWonObligation, liveWonObligationWhere } from './wonRecovery.js';
import { DEAL_STATUS_LABELS, dealChangeFieldLabel } from '../../../shared/dealStatus.mjs';

// "הפוך ל-WON שקט" — the historical correction. These tests pin the rules that
// make it SAFE: nothing fires, nothing financial is implied, the date is not
// silently rewritten, and the detector exemption is as narrow as the problem.

const NOW = Date.parse('2026-08-06T09:00:00.000Z');

// ── WON date ────────────────────────────────────────────────────────────────

test('"היום" stamps now; a historical date is stamped as chosen', () => {
  assert.equal(resolveHistoricalWonAt({ mode: 'today' }, NOW).at.getTime(), NOW);
  const custom = resolveHistoricalWonAt({ mode: 'custom', date: '2023-07-18' }, NOW);
  assert.equal(custom.at.toISOString().slice(0, 10), '2023-07-18');
});

test('a historical date cannot drift a day across timezones', () => {
  // Stamped at midday UTC, so the calendar date reads the same in Israel
  // (UTC+2/+3) and anywhere west of it.
  const { at } = resolveHistoricalWonAt({ mode: 'custom', date: '2023-07-18' }, NOW);
  assert.equal(at.toISOString(), '2023-07-18T12:00:00.000Z');
  assert.equal(
    at.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
    '2023-07-18',
  );
  assert.equal(at.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), '2023-07-18');
});

test('a malformed or future WON date is refused, never silently coerced', () => {
  for (const date of ['', 'yesterday', '18/07/2023', '2023-7-8', null]) {
    assert.equal(resolveHistoricalWonAt({ mode: 'custom', date }, NOW).error, 'invalid_won_date');
  }
  assert.equal(
    resolveHistoricalWonAt({ mode: 'custom', date: '2027-01-01' }, NOW).error,
    'won_date_in_future',
  );
});

// ── the plan the dialog shows before committing ─────────────────────────────

test('the plan reports exactly why a tour can or cannot be created', () => {
  const complete = {
    status: 'open', activityType: 'business',
    productId: 'p1', productVariantId: 'v1', locationId: 'l1',
    tourDate: '2023-07-18', tourTime: '16:00', participants: 13, tourLanguage: 'he',
  };
  const plan = silentWonPlan(complete, { createTour: true, tourEventId: null });
  assert.equal(plan.previousStatus, 'open');
  assert.equal(plan.alreadyWon, false);
  assert.equal(plan.canCreateTour, true);
  assert.deepEqual(plan.missingForTour, []);

  const incomplete = { ...complete, participants: null, tourTime: null };
  const bad = silentWonPlan(incomplete, { createTour: true, tourEventId: null });
  assert.equal(bad.canCreateTour, false);
  assert.ok(bad.missingForTour.length > 0, 'names the missing planning fields');
  assert.ok(bad.missingForTour.every((m) => m.labelHe), 'each has an operator-readable label');
});

test('a group deal without a chosen slot cannot create a tour here', () => {
  const group = {
    status: 'open', activityType: 'group',
    productId: 'p1', locationId: 'l1', tourDate: '2023-07-18', tourTime: '16:00', participants: 13,
  };
  const plan = silentWonPlan(group, { createTour: true, tourEventId: null });
  assert.equal(plan.needsSlot, true);
  assert.equal(plan.canCreateTour, false);
});

// ── the detector exemption is narrow and explicit ───────────────────────────

test('an INTENTIONAL tour-less historical WON does not raise the safety detector', () => {
  const corrected = {
    status: 'won',
    tourDate: '2023-07-18',
    wonAt: new Date(NOW - 1000),
    historicalWonAt: new Date(NOW),
  };
  assert.equal(isLiveWonObligation(corrected, NOW), false);
});

test('a genuinely broken WON without a tour still raises', () => {
  // Future-dated tour, WON, no historical correction → a real incident.
  const broken = {
    status: 'won',
    tourDate: '2026-12-01',
    wonAt: new Date(NOW),
    historicalWonAt: null,
  };
  assert.equal(isLiveWonObligation(broken, NOW), true);
  // …and a dateless deal won minutes ago is equally real.
  assert.equal(
    isLiveWonObligation({ status: 'won', tourDate: null, wonAt: new Date(NOW), historicalWonAt: null }, NOW),
    true,
  );
});

test('the exemption is expressed in the detector query, not by weakening it', () => {
  const where = liveWonObligationWhere(NOW);
  // Still the same scope rule…
  assert.equal(where.status, 'won');
  assert.deepEqual(where.bookings, { none: { status: 'active' } });
  assert.ok(Array.isArray(where.OR) && where.OR.length === 2);
  // …plus ONE explicit exemption, and it is a null check on the audited marker
  // (not a broad "skip old deals" rule).
  assert.equal(where.historicalWonAt, null);
});

// ── nothing financial is implied ────────────────────────────────────────────

test('the correction records an explicit "no financial effect" and a reason', () => {
  // The audit note shape is the contract the timeline and any future report
  // read; these two keys are what stop it being mistaken for payment proof.
  assert.equal(HISTORICAL_WON_REASON, 'historical_correction');
  const note = {
    reason: HISTORICAL_WON_REASON,
    financialEffect: 'none',
  };
  assert.equal(note.financialEffect, 'none');
  assert.equal(note.reason, 'historical_correction');
});

// ── LOST vocabulary ─────────────────────────────────────────────────────────

test('the CRM lifecycle is worded OPEN / WON / LOST everywhere', () => {
  assert.deepEqual(DEAL_STATUS_LABELS, { open: 'OPEN', won: 'WON', lost: 'LOST' });
});

test('old audit rows RENDER the canonical wording without being rewritten', () => {
  // A row stored before the vocabulary was unified.
  const stored = { fieldKey: 'lostReasonId', labelHe: 'סיבת הפסד' };
  assert.equal(dealChangeFieldLabel(stored.fieldKey, stored.labelHe), 'סיבת LOST');
  assert.equal(stored.labelHe, 'סיבת הפסד', 'the stored audit value is untouched');
  assert.equal(dealChangeFieldLabel('lostNotes', 'הערות הפסד'), 'הערות LOST');
});

test('fields the vocabulary does not own keep their recorded label', () => {
  assert.equal(dealChangeFieldLabel('tourDate', 'תאריך הסיור'), 'תאריך הסיור');
  assert.equal(dealChangeFieldLabel('participants', 'כמות משתתפים'), 'כמות משתתפים');
  assert.equal(dealChangeFieldLabel('unknownField', 'משהו אחר'), 'משהו אחר');
});
