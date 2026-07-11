// The ONE rule for "this tour is operationally closed" — used by the
// questionnaire engine to decide when tour-operational submissions (coordination,
// tour summary) stop following the live definition and freeze into history.
//
// A tour is closed when:
//   • its status is terminal (completed | cancelled), or
//   • its end time (date + startTime + variant duration — the same canonical
//     tourEndMs the Guide Portal's upcoming/past split uses) passed more than
//     the grace window ago.
//
// The grace window exists because the Tour Summary is BY NATURE filled after
// the tour ends — freezing exactly at tour end would lock the summary before
// the guide can write it. Seven days is a policy choice, deliberately a single
// named constant.
//
// Pure module — takes already-fetched rows, no DB access.

import { tourEndMs } from './guidePortal/dto.js';

export const TOUR_QUESTIONNAIRE_LOCK_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Shape needed from TourEvent: { status, date, startTime, productVariant?: { durationHours } }
export function tourQuestionnairesLocked(tour, nowMs = Date.now()) {
  if (!tour) return false;
  if (tour.status === 'completed' || tour.status === 'cancelled') return true;
  const end = tourEndMs(tour);
  if (Number.isNaN(end)) return false;
  return nowMs > end + TOUR_QUESTIONNAIRE_LOCK_GRACE_MS;
}
