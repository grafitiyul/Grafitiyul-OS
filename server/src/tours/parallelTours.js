// Parallel Tours — THE one canonical selector for "other tours happening at
// approximately the same time as a viewed tour". Time proximity is the WHOLE
// definition: a parallel tour is another TourEvent whose START datetime is
// within ±PARALLEL_WINDOW_MS of the viewed tour's start — inclusive, DST-safe,
// and correct across midnight / month / year boundaries. There is NO same-city,
// same-product, same-template or same-guide requirement.
//
// Nothing is stored. The relationship is computed live from current TourEvent
// start times on every read, so a change to a tour's time, status, team or
// seat count appears automatically with no reconciliation and no duplicated
// state. Both the admin tour route and the guide-portal tour route call this
// ONE selector; each then shapes its own permission-appropriate DTO
// (toAdminParallelTours here, guideParallelToursDto in guidePortal/dto.js). The
// selector itself reads only operational tour fields + assignment display
// names — it never touches bookings, deals or any customer data.

import { occupancyFor } from './occupancy.js';
import {
  wallTimeToEpoch,
  variantDisplayName,
  isHebrewTour,
  CALENDAR_TIMEZONE,
} from './calendar/desiredState.js';

// ±3 hours, INCLUSIVE. A tour exactly 3h before or after the viewed one is a
// parallel tour; 3h + 1 minute is not.
export const PARALLEL_WINDOW_MS = 3 * 60 * 60 * 1000;

// Operationally-relevant statuses. A parallel tour is one that genuinely
// occupies the time slot:
//   • scheduled — will happen as planned
//   • completed — did happen (its team/seats really occupied that slot)
// Excluded:
//   • cancelled — never happened
//   • postponed — has no date/startTime, so it cannot occupy any time window
//     (also structurally excluded by the `startTime: { not: null }` filter).
// Superseded twins (supersededByTourEventId) are hidden from every GOS view and
// are excluded here too.
export const PARALLEL_STATUSES = ['scheduled', 'completed'];

// Every assigned role is operationally relevant staff on the tour.
const ROLE_ORDER = { lead_guide: 0, guide: 1, workshop_assistant: 2 };

// The calendar dates whose tours could fall within ±window of a wall time on
// `dateStr`. A window < 24h can only reach the ADJACENT days, so the candidate
// set is {d-1, d, d+1}. Pure — UTC date math, so it is month/year-boundary safe
// and never depends on the server's local timezone.
export function candidateDates(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return [];
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const DAY = 24 * 60 * 60 * 1000;
  return [-1, 0, 1].map((d) => new Date(base + d * DAY).toISOString().slice(0, 10));
}

// Deduped, role-ordered staff for one tour's assignments. Every assigned role
// counts (lead_guide, guide, workshop_assistant). Uniqueness is structural (one
// assignment row per person per tour via @@unique) but we also dedupe by
// display name defensively and keep each person's most senior role for the
// chip tone. Returns [{ displayName, role }] sorted lead → guide → assistant.
export function orderedStaff(assignments) {
  const byName = new Map();
  for (const a of assignments || []) {
    const displayName = String(a?.displayName || '').trim();
    if (!displayName) continue;
    const rank = ROLE_ORDER[a.role] ?? 99;
    const prev = byName.get(displayName);
    if (!prev || rank < prev.rank) byName.set(displayName, { displayName, role: a.role, rank });
  }
  return [...byName.values()]
    .sort((x, y) => x.rank - y.rank || x.displayName.localeCompare(y.displayName, 'he'))
    .map(({ displayName, role }) => ({ displayName, role }));
}

// A parallel-tour row reads ONLY operational tour fields + assignment display
// names. No bookings, no deal, no contacts — the selector cannot leak customer
// data because it never fetches any.
const PARALLEL_INCLUDE = {
  product: { select: { nameHe: true, nameEn: true } },
  productVariant: { select: { location: { select: { nameHe: true, nameEn: true } } } },
  location: { select: { nameHe: true, nameEn: true } },
  assignments: {
    orderBy: { createdAt: 'asc' },
    select: { displayName: true, role: true },
  },
};

// One canonical CORE row per parallel tour — the full operational summary both
// surfaces derive from. `epoch` is internal (used only for sorting) and is
// stripped by the DTO mappers.
function toCoreRow(tour, epoch, activeSeats) {
  const he = isHebrewTour(tour.tourLanguage);
  const productName = he ? tour.product?.nameHe : tour.product?.nameEn || tour.product?.nameHe;
  const variantName = variantDisplayName(tour, he); // canonical "product · city"
  const loc = tour.location || tour.productVariant?.location || null;
  const locationName = he ? loc?.nameHe : loc?.nameEn || loc?.nameHe;
  return {
    id: tour.id,
    date: tour.date,
    startTime: tour.startTime,
    epoch,
    status: tour.status,
    productName: productName || null,
    variantName: variantName || productName || null,
    locationName: locationName || null,
    participantCount: activeSeats || 0,
    staff: orderedStaff(tour.assignments),
  };
}

// Returns the parallel tours of `viewed`, as canonical core rows sorted by
// start datetime ASCENDING. `viewed` needs { id, date, startTime }. A tour with
// no date/startTime (postponed) has no time window → returns []. Never includes
// the viewed tour itself.
//
// Query budget: ONE findMany over ≤3 candidate dates, then ONE batched
// occupancyFor over the matched ids. No per-tour queries (no N+1).
export async function findParallelTours(client, viewed, { timeZone = CALENDAR_TIMEZONE } = {}) {
  if (!viewed?.id || !viewed?.date || !viewed?.startTime) return [];
  const viewedEpoch = wallTimeToEpoch(viewed.date, viewed.startTime, timeZone);
  if (!Number.isFinite(viewedEpoch)) return [];

  const dates = candidateDates(viewed.date);
  if (!dates.length) return [];

  const rows = await client.tourEvent.findMany({
    where: {
      id: { not: viewed.id }, // never the viewed tour itself
      date: { in: dates }, // coarse ±1 day bound; exact test is below
      startTime: { not: null }, // a real time is required to place it in the window
      status: { in: PARALLEL_STATUSES }, // scheduled/completed only (excludes cancelled/postponed)
      supersededByTourEventId: null, // superseded twins are hidden everywhere
    },
    include: PARALLEL_INCLUDE,
  });

  // Precise ±window test on COMPLETE datetimes (DST-safe wall→epoch). The date
  // pre-filter is only a coarse bound; this is the real inclusion rule and is
  // what makes cross-midnight comparisons correct.
  const within = [];
  for (const t of rows) {
    const epoch = wallTimeToEpoch(t.date, t.startTime, timeZone);
    if (!Number.isFinite(epoch)) continue;
    if (Math.abs(epoch - viewedEpoch) <= PARALLEL_WINDOW_MS) within.push({ tour: t, epoch });
  }
  if (!within.length) return [];

  // Canonical participant count — the SAME activeSeats SSOT every other surface
  // uses (occupancyFor), batched over all matched ids in one query.
  const occ = await occupancyFor(client, within.map(({ tour }) => tour.id));

  return within
    .sort((a, b) => a.epoch - b.epoch || a.tour.id.localeCompare(b.tour.id))
    .map(({ tour, epoch }) => toCoreRow(tour, epoch, occ[tour.id]?.activeSeats));
}

// ── Surface DTOs — expose only what each surface is allowed to see ───────────

// Admin sees the full operational summary (it already sees everything about
// every tour). Drop the internal `epoch` and expose the seat count under the
// same `participantsTotal` name the portal + tour-detail DTOs use.
export function toAdminParallelTours(rows) {
  return (rows || []).map(({ epoch, participantCount, ...row }) => ({
    ...row,
    participantsTotal: participantCount,
  }));
}
