import test from 'node:test';
import assert from 'node:assert/strict';
import {
  israelWallClockMs,
  salesWindowClosed,
  isOccurrenceSellable,
  isSentinelPriceMinor,
  isSentinelWooPrice,
  MAX_PUBLIC_TICKET_PRICE_MINOR,
} from './sellability.js';
import { variationMenuOrder, minorToWooPrice } from './desiredState.js';

// Regression suite for the storefront correction of 06.08.2026: Woo product 167
// publicly offered 02.08.2026 and 04.08.2026 — both already over — while
// 01.08 / 03.08 / 05.08 were correctly hidden. Every case below is a rule the
// public date picker must obey, pinned against the ONE canonical predicate.

const scheduled = (date, startTime) => ({ status: 'scheduled', date, startTime });

// 10:00 Israel on 08.08.2026 (summer, UTC+3) is 07:00Z.
const AUG8_1000_IL = Date.parse('2026-08-08T07:00:00Z');

test('israelWallClockMs is DST-exact in both directions (not a month guess)', () => {
  // Summer — UTC+3.
  assert.equal(israelWallClockMs('2026-08-08', '10:00'), Date.parse('2026-08-08T07:00:00Z'));
  // Winter — UTC+2.
  assert.equal(israelWallClockMs('2026-01-15', '10:00'), Date.parse('2026-01-15T08:00:00Z'));
  // The old month-based approximation (Apr–Sep ⇒ +3) got LATE-MARCH wrong.
  // 20.03 is standard time (UTC+2); the approximation would have said +3.
  assert.equal(israelWallClockMs('2026-03-20', '10:00'), Date.parse('2026-03-20T08:00:00Z'));
  // …and late October, after the clocks go back, is UTC+2 too.
  assert.equal(israelWallClockMs('2026-10-30', '10:00'), Date.parse('2026-10-30T08:00:00Z'));
  assert.ok(Number.isNaN(israelWallClockMs(null, '10:00')));
  assert.ok(Number.isNaN(israelWallClockMs('2026-08-08', null)));
});

// ── 1. Yesterday never appears ───────────────────────────────────────────────

test('1. yesterday is never sellable — even while still marked scheduled', () => {
  // THE production defect: status was still 'scheduled' (the completion sweep
  // had not run yet) and the template has NO registrationCloseMinutes, so the
  // old predicate derived "publish" for a tour that had already happened.
  const yesterday = scheduled('2026-08-07', '10:00');
  assert.equal(
    isOccurrenceSellable({ tour: yesterday, closeMinutes: null, nowMs: AUG8_1000_IL }),
    false,
  );
});

test('1b. a PAST occurrence stays unsellable however far back it is', () => {
  for (const date of ['2026-08-02', '2026-08-04', '2026-07-15', '2025-01-01']) {
    assert.equal(
      isOccurrenceSellable({ tour: scheduled(date, '17:00'), closeMinutes: null, nowMs: AUG8_1000_IL }),
      false,
      `${date} must not be sellable`,
    );
  }
});

// ── 2 + 3. Same-day: before its start yes, after its start no ────────────────

test('2. earlier-today activity is not sellable once its start has passed', () => {
  const earlyToday = scheduled('2026-08-08', '09:00'); // 06:00Z, an hour ago
  assert.equal(
    isOccurrenceSellable({ tour: earlyToday, closeMinutes: null, nowMs: AUG8_1000_IL }),
    false,
  );
});

test('2b. the sales window closes it EARLIER when the template configures one', () => {
  const laterToday = scheduled('2026-08-08', '11:00'); // starts in 1h
  // No cutoff → still sellable.
  assert.equal(isOccurrenceSellable({ tour: laterToday, closeMinutes: null, nowMs: AUG8_1000_IL }), true);
  // 90-minute cutoff → the window already closed.
  assert.equal(isOccurrenceSellable({ tour: laterToday, closeMinutes: 90, nowMs: AUG8_1000_IL }), false);
  // 30-minute cutoff → still open.
  assert.equal(isOccurrenceSellable({ tour: laterToday, closeMinutes: 30, nowMs: AUG8_1000_IL }), true);
});

test('3. valid later-today activity IS sellable while still in its window', () => {
  assert.equal(
    isOccurrenceSellable({ tour: scheduled('2026-08-08', '18:00'), closeMinutes: null, nowMs: AUG8_1000_IL }),
    true,
  );
});

test('3b. the boundary is exact — sellable up to, but not at, the cutoff', () => {
  const start = israelWallClockMs('2026-08-08', '18:00');
  const tour = scheduled('2026-08-08', '18:00');
  assert.equal(isOccurrenceSellable({ tour, closeMinutes: null, nowMs: start - 1 }), true);
  assert.equal(isOccurrenceSellable({ tour, closeMinutes: null, nowMs: start }), false);
});

// ── 4. Tomorrow / future ─────────────────────────────────────────────────────

test('4. tomorrow and future activity is sellable', () => {
  for (const date of ['2026-08-09', '2026-08-31', '2027-03-01']) {
    assert.equal(
      isOccurrenceSellable({ tour: scheduled(date, '10:00'), closeMinutes: null, nowMs: AUG8_1000_IL }),
      true,
      `${date} must be sellable`,
    );
  }
});

// ── 5. Cancelled / non-scheduled future activity ─────────────────────────────

test('5. a cancelled FUTURE occurrence is never sellable', () => {
  const future = { date: '2026-08-20', startTime: '18:00' };
  assert.equal(isOccurrenceSellable({ tour: { ...future, status: 'scheduled' }, nowMs: AUG8_1000_IL }), true);
  for (const status of ['cancelled', 'completed', 'postponed']) {
    assert.equal(
      isOccurrenceSellable({ tour: { ...future, status }, nowMs: AUG8_1000_IL }),
      false,
      `${status} must not be sellable`,
    );
  }
});

test('5b. an occurrence with no concrete date/time is never sellable', () => {
  assert.equal(isOccurrenceSellable({ tour: { status: 'scheduled', date: null, startTime: null }, nowMs: AUG8_1000_IL }), false);
  assert.equal(isOccurrenceSellable({ tour: { status: 'scheduled', date: '2026-08-20', startTime: null }, nowMs: AUG8_1000_IL }), false);
  assert.equal(isOccurrenceSellable({ tour: null, nowMs: AUG8_1000_IL }), false);
});

// ── 6. Chronological order, nearest first ────────────────────────────────────

test('6. sellable dates sort nearest-first by the stamped menu_order', () => {
  const occurrences = [
    ['2026-08-31', '10:00'],
    ['2026-08-09', '18:00'],
    ['2026-08-09', '10:00'],
    ['2026-12-31', '23:00'],
    ['2027-01-01', '07:00'],
  ];
  const sorted = [...occurrences]
    .sort((a, b) => variationMenuOrder(...a) - variationMenuOrder(...b))
    .map(([d, t]) => `${d} ${t}`);
  assert.deepEqual(sorted, [
    '2026-08-09 10:00',
    '2026-08-09 18:00',
    '2026-08-31 10:00',
    '2026-12-31 23:00',
    '2027-01-01 07:00',
  ]);
});

// ── 7. Israel timezone around midnight ───────────────────────────────────────

test('7. the midnight boundary is Israeli, not UTC', () => {
  // 21:30Z on 08.08 is already 00:30 on 09.08 in Israel (UTC+3).
  const justAfterIlMidnight = Date.parse('2026-08-08T21:30:00Z');
  // An occurrence at 10:00 on 09.08 is still 9.5h away → sellable.
  assert.equal(
    isOccurrenceSellable({ tour: scheduled('2026-08-09', '10:00'), nowMs: justAfterIlMidnight }),
    true,
  );
  // The 08.08 evening tour is over → not sellable.
  assert.equal(
    isOccurrenceSellable({ tour: scheduled('2026-08-08', '18:00'), nowMs: justAfterIlMidnight }),
    false,
  );
  // Just BEFORE Israeli midnight (20:30Z = 23:30 IL on 08.08) a 09.08 tour is
  // still sellable, and naive UTC-date reasoning would already have called it
  // "tomorrow" — the predicate never compares calendar strings, only instants.
  const justBeforeIlMidnight = Date.parse('2026-08-08T20:30:00Z');
  assert.equal(
    isOccurrenceSellable({ tour: scheduled('2026-08-09', '10:00'), nowMs: justBeforeIlMidnight }),
    true,
  );
});

test('7b. winter midnight (UTC+2) behaves the same', () => {
  const justAfterIlMidnight = Date.parse('2026-01-14T22:30:00Z'); // 00:30 IL, 15.01
  assert.equal(isOccurrenceSellable({ tour: scheduled('2026-01-15', '10:00'), nowMs: justAfterIlMidnight }), true);
  assert.equal(isOccurrenceSellable({ tour: scheduled('2026-01-14', '18:00'), nowMs: justAfterIlMidnight }), false);
});

// ── 9. Sentinel / placeholder prices are never customer-visible ──────────────

test('9. a placeholder price is recognised as a sentinel', () => {
  // The exact production value on Woo product 171 variation 1064.
  assert.equal(isSentinelWooPrice('100000'), true);
  assert.equal(isSentinelPriceMinor(100000 * 100), true);
  assert.equal(isSentinelPriceMinor(MAX_PUBLIC_TICKET_PRICE_MINOR), true);
  // Real ticket prices on this store are ₪90–₪250 — never flagged.
  for (const p of ['90.00', '150.00', '200.00', '250.00']) assert.equal(isSentinelWooPrice(p), false);
  for (const m of [9000, 15000, 20000, 25000]) assert.equal(isSentinelPriceMinor(m), false);
  // Absent price is not a sentinel (it means "leave the variation alone").
  assert.equal(isSentinelPriceMinor(null), false);
  assert.equal(isSentinelWooPrice(''), false);
  assert.equal(isSentinelWooPrice(null), false);
});

test('9b. GOS REFUSES to publish a sentinel price rather than shipping it', () => {
  assert.equal(minorToWooPrice(25000), '250.00');
  assert.throws(() => minorToWooPrice(100000 * 100), /placeholder price/);
});

// ── The sales-window helper in isolation ────────────────────────────────────

test('salesWindowClosed treats an unplaceable occurrence as closed, never open', () => {
  assert.equal(salesWindowClosed(null, '10:00', null, AUG8_1000_IL), true);
  assert.equal(salesWindowClosed('2026-08-08', null, null, AUG8_1000_IL), true);
  assert.equal(salesWindowClosed('not-a-date', '10:00', null, AUG8_1000_IL), true);
});
