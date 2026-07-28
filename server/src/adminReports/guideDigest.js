// Report #11 — the per-guide daily digest (08:00 Israel).
//
// One message per guide, containing ONLY that guide's own tours (owner
// decision, 2026-07-28): their coordination calls for the monitor window, then
// their own overdue summaries. A guide never sees another guide's customers.
//
// Every fact comes from the same canonical sources the office reports use —
// coordination submissions per BOOKING, summary submissions per GUIDE via
// actorScope, REQUIRED_SUMMARY_ROLES, and Location.isHomeLocation compared by
// id. Nothing is re-derived here.

import { prisma } from '../db.js';
import { israelToday, addDays, compareDates } from '../lib/israelDate.js';
import { notifiableGuides, guideFirstName, guideFullName, GUIDE_ASSIGNMENT_SELECT } from '../tours/guides.js';
import { REQUIRED_SUMMARY_ROLES } from '../tours/completion.js';
import { tourStartMs, DONE_STATUSES, COORDINATION_MONITOR_DAYS } from './coordination.js';
import { tourCustomerLabel } from './tourFacts.js';

const LIVE = ['scheduled', 'completed'];

/** How far back an unfiled summary keeps appearing in the digest. */
export const MISSING_SUMMARY_LOOKBACK_DAYS = 30;

const DIGEST_TOUR_SELECT = {
  id: true, date: true, startTime: true, status: true, locationId: true,
  product: { select: { nameHe: true } },
  location: { select: { nameHe: true } },
  productVariant: { select: { locationId: true, location: { select: { nameHe: true } } } },
  assignments: { select: GUIDE_ASSIGNMENT_SELECT, orderBy: { createdAt: 'asc' } },
  bookings: {
    where: { status: 'active' },
    select: {
      id: true,
      deal: {
        select: {
          participants: true,
          organization: { select: { name: true } },
          contacts: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1,
            select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } },
          },
        },
      },
    },
  },
};

/** Whole Israel calendar days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Build one digest per guide who has anything to say. Returns
 * [{ recipient, guideDigest }] — empty when nobody has anything, and a guide
 * with neither coordination items nor overdue summaries is simply absent.
 */
export async function collectGuideDigests({ nowMs = Date.now(), client = prisma } = {}) {
  const today = israelToday(nowMs);
  const windowEnd = addDays(today, COORDINATION_MONITOR_DAYS - 1);
  const summaryFrom = addDays(today, -MISSING_SUMMARY_LOOKBACK_DAYS);

  const tours = await client.tourEvent.findMany({
    where: { status: { in: LIVE }, date: { gte: summaryFrom, lte: windowEnd } },
    select: DIGEST_TOUR_SELECT,
  });
  if (!tours.length) return [];

  const home = await client.location.findFirst({ where: { isHomeLocation: true }, select: { id: true } });
  const homeLocationId = home?.id || null;

  const tourIds = tours.map((t) => t.id);
  const bookingIds = tours.flatMap((t) => t.bookings.map((b) => b.id));
  const [coordSubs, summarySubs] = await Promise.all([
    bookingIds.length
      ? client.questionnaireSubmission.findMany({
        where: {
          subjectType: 'booking', subjectId: { in: bookingIds },
          purpose: 'coordination', status: { in: DONE_STATUSES },
        },
        select: { subjectId: true },
      })
      : [],
    client.questionnaireSubmission.findMany({
      where: {
        subjectType: 'tour_event', subjectId: { in: tourIds },
        purpose: 'tour_summary', status: { in: DONE_STATUSES },
      },
      select: { subjectId: true, actorScope: true },
    }),
  ]);
  const coordDone = new Set(coordSubs.map((s) => s.subjectId));
  const summaryDone = new Set(summarySubs.map((s) => `${s.subjectId}:${s.actorScope}`));

  // guide externalPersonId → { recipient, coordination[], missingSummaries[] }
  const byGuide = new Map();
  const ensure = (a) => {
    const key = a.externalPersonId;
    if (!byGuide.has(key)) {
      byGuide.set(key, {
        recipient: {
          personRefId: a.personRef?.id || null,
          phone: a.personRef?.phone || null,
          name: guideFullName(a),
          firstName: guideFirstName(a),
          portalToken: a.personRef?.portalToken || null,
        },
        coordination: [],
        missingSummaries: [],
      });
    }
    return byGuide.get(key);
  };

  for (const tour of tours) {
    const inWindow = compareDates(tour.date, today) >= 0 && compareDates(tour.date, windowEnd) <= 0;
    const isPast = compareDates(tour.date, today) < 0;
    const cityName = tour.location?.nameHe || tour.productVariant?.location?.nameHe || null;
    const locationId = tour.locationId ?? tour.productVariant?.locationId ?? null;
    const customerName = tourCustomerLabel(tour);
    const productName = tour.product?.nameHe || null;

    // ── upcoming: the coordination line, one per BOOKING (canonical unit) ──
    if (inWindow) {
      const daysAway = daysBetween(today, tour.date);
      for (const a of notifiableGuides(tour.assignments)) {
        const bucket = ensure(a);
        for (const b of tour.bookings) {
          const deal = b.deal;
          bucket.coordination.push({
            done: coordDone.has(b.id),
            daysAway,
            tourDate: tour.date,
            tourStartMs: tourStartMs(tour),
            customerName: deal?.organization?.name
              || `${deal?.contacts?.[0]?.contact?.firstNameHe || ''} ${deal?.contacts?.[0]?.contact?.lastNameHe || ''}`.trim()
              || customerName,
            participants: deal?.participants ?? null,
            productName,
            cityName,
            locationId,
            homeLocationId,
          });
        }
      }
    }

    // ── past: summaries this guide still owes (yesterday or earlier only) ──
    if (isPast) {
      const startMs = tourStartMs(tour);
      if (startMs == null || startMs > nowMs) continue;
      for (const a of tour.assignments) {
        if (!REQUIRED_SUMMARY_ROLES.includes(a.role)) continue;
        if (!a.externalPersonId) continue;
        if (summaryDone.has(`${tour.id}:${a.externalPersonId}`)) continue;
        ensure(a).missingSummaries.push({
          tourDate: tour.date, tourStartMs: startMs, customerName, productName,
        });
      }
    }
  }

  const out = [];
  for (const entry of byGuide.values()) {
    if (!entry.coordination.length && !entry.missingSummaries.length) continue;
    // Nearest tour first; missing summaries oldest first.
    entry.coordination.sort((a, b) => (a.tourStartMs ?? 0) - (b.tourStartMs ?? 0));
    entry.missingSummaries.sort((a, b) => a.tourStartMs - b.tourStartMs);
    out.push({
      recipient: entry.recipient,
      guideDigest: { coordination: entry.coordination, missingSummaries: entry.missingSummaries },
    });
  }
  // Stable order so a run is reproducible.
  out.sort((a, b) => String(a.recipient.name).localeCompare(String(b.recipient.name), 'he'));
  return out;
}
