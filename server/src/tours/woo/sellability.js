// THE ONE authority on "may this occurrence be offered to the public RIGHT NOW?"
//
// Before this module existed, sellability was implied by two loose terms spread
// across desiredState.js and syncWorker.js:
//     disabled = tour.status !== 'scheduled' || !hasDate || registrationClosed
// and NOTHING in that expression referred to the occurrence actually being over.
// `registrationClosed` came from a template's registrationCloseMinutes, which is
// null for the live Tel Aviv template — so a PAST occurrence that was still
// `scheduled` at reconcile time derived as PUBLISHABLE and stayed purchasable on
// the storefront forever (production: variations 2030-2033 / 2042-2045 on
// product 167, dates 02.08.2026 + 04.08.2026, still on sale on 06.08.2026).
//
// The rule now has ONE owner, one expression, one clock. Every caller — the
// desired-state builders, the sync worker, the sweeps and the repair job — asks
// this module; none of them re-derives it.
//
// Pure: no imports beyond the canonical timezone, no I/O, injectable clock.

import { ISRAEL_TZ } from '../../lib/israelDate.js';

const tzDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: ISRAEL_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Israel is UTC+2 (standard) or UTC+3 (DST). DST FIRST: at the twice-a-year
// fall-back the same wall clock maps to two instants, and for a SALES CUTOFF the
// earlier one is the safe choice (close sooner, never sell into a passed slot).
const IL_OFFSETS_HOURS = [3, 2];

/**
 * An Israel wall clock ("2026-08-04", "17:00") → the UTC instant in ms.
 *
 * DST-correct without a timezone library, by the same probe technique as
 * israelDate.midnightAfterMs: build the candidate instant for each offset and
 * keep the one that formats BACK to the wall clock we were given. A month-based
 * offset guess (what the old occurrenceClosed used) is wrong for two weeks a
 * year — tolerable for a soft booking cutoff, NOT for the rule that decides
 * whether a past date is purchasable.
 *
 * Returns NaN for an unparsable date/time. During the one-hour spring-forward
 * gap no candidate round-trips; the post-transition offset (UTC+3) is used, so
 * the function never returns NaN for a well-formed input.
 */
export function israelWallClockMs(date, startTime) {
  if (!date || !startTime) return Number.NaN;
  const base = Date.parse(`${date}T${startTime}:00Z`);
  if (Number.isNaN(base)) return Number.NaN;
  const want = `${String(date).slice(8, 10)}/${String(date).slice(5, 7)}/${String(date).slice(0, 4)}, ${startTime}`;
  for (const offset of IL_OFFSETS_HOURS) {
    const candidate = base - offset * 3_600_000;
    if (tzDateTime.format(new Date(candidate)) === want) return candidate;
  }
  // Spring-forward gap: the wall clock does not exist. Fall back to UTC+3.
  return base - IL_OFFSETS_HOURS[0] * 3_600_000;
}

/**
 * Has the sales window for this occurrence closed?
 *
 * closeMinutes is the template's registrationCloseMinutes — "stop selling N
 * minutes before the start". NULL MEANS ZERO, NOT "NEVER": an occurrence stops
 * being purchasable when it starts, always. The old contract ("null → never
 * auto-closes") is exactly the hole that kept finished tours on sale, and it is
 * deliberately not preserved.
 *
 * One expression covers every case the storefront needs:
 *   yesterday                 → start long past      → closed
 *   earlier today             → start past           → closed
 *   later today, in window    → start ahead          → OPEN
 *   later today, past cutoff  → within closeMinutes  → closed
 *   tomorrow / future         → start ahead          → OPEN
 */
export function salesWindowClosed(date, startTime, closeMinutes, nowMs = Date.now()) {
  const startMs = israelWallClockMs(date, startTime);
  // An occurrence we cannot place on the clock can never be proven sellable.
  if (!Number.isFinite(startMs)) return true;
  const minutes = closeMinutes == null ? 0 : Number(closeMinutes);
  const cutoff = startMs - (Number.isFinite(minutes) ? minutes : 0) * 60_000;
  return nowMs >= cutoff;
}

/**
 * THE canonical public-sellability predicate for ONE occurrence.
 *
 *   tour:         { status, date, startTime }
 *   closeMinutes: the template's registrationCloseMinutes (null = close at start)
 *
 * True ⇒ the occurrence MAY be published and purchasable on the storefront.
 * False ⇒ every variation of it must be draft, zero-stock and unpurchasable.
 */
export function isOccurrenceSellable({ tour, closeMinutes = null, nowMs = Date.now() } = {}) {
  if (!tour) return false;
  // Cancelled / completed / postponed are never on sale.
  if (tour.status !== 'scheduled') return false;
  // No concrete occurrence to sell (a postponed slot keeps its variation hidden).
  if (!tour.date || !tour.startTime) return false;
  // Over, or past its sales cutoff.
  if (salesWindowClosed(tour.date, tour.startTime, closeMinutes, nowMs)) return false;
  return true;
}

// ── Placeholder-price guard ─────────────────────────────────────────────────
//
// Real public ticket prices on this store are ₪90–₪250. A value orders of
// magnitude above that is a technical placeholder someone typed while building a
// product (production: Woo product 171 "סיור גרפיטי בחיפה" variation 1064 carried
// regular_price 100000, which the public Store API published as "100,000.00 ₪").
// Such a number must never reach a customer, so GOS refuses to WRITE one and the
// audit refuses to leave one purchasable. 40× headroom over the real ceiling.
export const MAX_PUBLIC_TICKET_PRICE_MINOR = 1_000_000; // ₪10,000

/** Is this a technical/sentinel price rather than a real customer-facing one? */
export function isSentinelPriceMinor(priceMinor) {
  if (priceMinor == null) return false;
  const n = Number(priceMinor);
  return Number.isFinite(n) && n >= MAX_PUBLIC_TICKET_PRICE_MINOR;
}

/** The same guard against a Woo decimal price string ("100000", "250.00"). */
export function isSentinelWooPrice(price) {
  if (price == null || price === '') return false;
  const n = Number(price);
  return Number.isFinite(n) && n * 100 >= MAX_PUBLIC_TICKET_PRICE_MINOR;
}
