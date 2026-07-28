// A new participant joined an OPEN tour → Admin Report #13.
//
// Business gate (owner rule): this only makes sense AFTER the official
// coordination-call notification (#12) went out for that tour and that guide.
// Before that point the guide has not been told about the tour at all, and the
// full participant list will arrive in #12 anyway — so an early "someone
// joined" message would be noise. The gate is evidence-based: a SENT #12
// delivery row for this tour and this guide.
//
// Called from the canonical registration mirror, so every channel that can add
// a participant (progressive hold→confirm, no-payment registration, a settled
// payment webhook) is covered by one wiring.

import { prisma } from '../db.js';
import { fireAdminReport } from './dispatch.js';
import { notifiableGuides, guideFirstName, guideFullName, GUIDE_ASSIGNMENT_SELECT } from '../tours/guides.js';
import { guideTourUrl } from '../tours/guidePortal/links.js';

/** Has the coordination-call notification already gone out to this guide? */
export async function coordinationNoticeSent(tourEventId, externalPersonId, client = prisma) {
  const row = await client.adminReportDelivery.findUnique({
    where: {
      reportNumber_idempotencyKey: {
        reportNumber: 12,
        idempotencyKey: `coord_call:${tourEventId}:${externalPersonId}`,
      },
    },
    select: { status: true },
  });
  return row?.status === 'sent';
}

/**
 * Report one newly-registered participant to the tour's guides.
 * `registrationId` makes the report idempotent per registration per guide.
 */
export async function reportOpenTourParticipant(
  { tourEventId, registrationId, customerName, count },
  { client = prisma, log = console } = {},
) {
  if (!tourEventId || !registrationId) return { skipped: 'incomplete' };
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    select: {
      id: true, kind: true, status: true, date: true, startTime: true,
      assignments: { select: GUIDE_ASSIGNMENT_SELECT, orderBy: { createdAt: 'asc' } },
    },
  });
  // Open tours only, and never for a tour that is off.
  if (!tour || tour.kind !== 'group_slot' || tour.status === 'cancelled') return { skipped: 'not_live_open_tour' };

  const fired = [];
  for (const a of notifiableGuides(tour.assignments)) {
    if (!(await coordinationNoticeSent(tour.id, a.externalPersonId, client))) continue;
    const r = await fireAdminReport({
      number: 13,
      idempotencyKey: `open_join:${registrationId}:${a.externalPersonId}`,
      tourEventId: tour.id,
      recipient: {
        personRefId: a.personRef?.id || null,
        phone: a.personRef?.phone || null,
        name: guideFullName(a),
        firstName: guideFirstName(a),
      },
      data: {
        guideNotice: {
          newCustomerName: customerName || null,
          newCustomerCount: count ?? null,
          tourDate: tour.date,
          tourTime: tour.startTime,
          tourEventId: tour.id,
          portalUrl: guideTourUrl(a.personRef, tour.id),
        },
      },
    }, log);
    if (r?.ok) fired.push(a.externalPersonId);
  }
  return { fired };
}
