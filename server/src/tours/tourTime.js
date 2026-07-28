// THE canonical tour start/end instants.
//
// Consolidation note (2026-07-28): two implementations existed and disagreed.
//   * tours/calendar/desiredState.js — 2h fallback, honours the open-tour
//     durationHoursOverride, DST-correct via wallTimeToEpoch.
//   * tours/guidePortal/dto.js tourEndMs — 3h fallback, ignored the override,
//     and parsed "YYYY-MM-DDTHH:MM:SS" with NO zone, i.e. in the SERVER's
//     timezone (UTC in production) — a 2–3 hour error on every tour.
// This module keeps the correct behaviour of the first and becomes the single
// definition; the portal DTO now delegates here. The Google Calendar builder
// keeps its own inline arithmetic (it needs the warning text for a missing
// duration) but reads the SAME constants and the same wallTimeToEpoch.

import { wallTimeToEpoch, DEFAULT_DURATION_HOURS } from './calendar/desiredState.js';

export { DEFAULT_DURATION_HOURS };

/**
 * Tour duration in hours. Operational override (an open-tour slot may pin its
 * own duration) beats the variant's configured duration; neither present falls
 * back to the platform default.
 */
export function tourDurationHours(tour) {
  const override = Number(tour?.openTourTemplate?.durationHoursOverride);
  if (Number.isFinite(override) && override > 0) return override;
  const variant = Number(tour?.productVariant?.durationHours);
  if (Number.isFinite(variant) && variant > 0) return variant;
  return DEFAULT_DURATION_HOURS;
}

/** The tour's real start instant (ms), or null when it has no datetime. */
export function tourStartMs(tour) {
  if (!tour?.date) return null;
  const ms = wallTimeToEpoch(tour.date, tour.startTime || '00:00');
  return Number.isFinite(ms) ? ms : null;
}

/** The tour's real end instant (ms) — start + duration. Null when undated. */
export function tourEndMs(tour) {
  const start = tourStartMs(tour);
  if (start == null) return null;
  return start + Math.round(tourDurationHours(tour) * 60) * 60 * 1000;
}

/** Has the tour finished as of `nowMs`? */
export function hasTourEnded(tour, nowMs = Date.now()) {
  const end = tourEndMs(tour);
  return end != null && end <= nowMs;
}

/** Prisma select fragment carrying everything the duration rule needs. */
export const TOUR_TIME_SELECT = {
  date: true,
  startTime: true,
  productVariant: { select: { durationHours: true } },
  openTourTemplateId: true,
};
