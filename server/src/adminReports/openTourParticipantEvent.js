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
import { staffFormLinkUrl } from '../questionnaires/staffLinks.js';
import { dealContactName } from './tourFacts.js';
import { staffLanguage } from '../../../shared/staffName.mjs';

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
      // Product/city facts so #13 renders the same family layout as #12.
      product: { select: { nameHe: true, nameEn: true } },
      location: { select: { nameHe: true, nameEn: true, isHomeLocation: true } },
      productVariant: { select: { location: { select: { nameHe: true, nameEn: true, isHomeLocation: true } } } },
      assignments: { select: GUIDE_ASSIGNMENT_SELECT, orderBy: { createdAt: 'asc' } },
    },
  });
  // Open tours only, and never for a tour that is off.
  if (!tour || tour.kind !== 'group_slot' || tour.status === 'cancelled') return { skipped: 'not_live_open_tour' };

  // #13 announces a NEW customer, so its link must open THAT customer's
  // coordination form. A registration identifies the customer via its deal; the
  // booking is that deal's participation in this tour. No booking (a
  // registration not yet converted) → no link rather than a wrong one.
  const registration = await client.ticketRegistration.findUnique({
    where: { id: registrationId },
    select: { dealId: true },
  });
  const deal = registration?.dealId
    ? await client.deal.findUnique({
      where: { id: registration.dealId },
      select: {
        participants: true,
        organization: { select: { name: true } },
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1,
          select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } },
        },
      },
    })
    : null;
  const booking = registration?.dealId
    ? await client.booking.findFirst({
      where: { tourEventId: tour.id, dealId: registration.dealId, status: { not: 'cancelled' } },
      select: { id: true },
    })
    : null;

  const loc = tour.location || tour.productVariant?.location || null;

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
        // Same contract as #12/#14-#16: render in the guide's language when
        // the office enables it.
        preferredLanguage: staffLanguage(a.personRef),
      },
      data: {
        guideNotice: {
          newCustomerName: customerName || null,
          newCustomerCount: count ?? null,
          // #12-family layout facts — everything is about THIS booking only.
          contactName: dealContactName(deal) || customerName || null,
          orgName: deal?.organization?.name || null,
          participants: deal?.participants ?? count ?? null,
          productNameHe: tour.product?.nameHe || null,
          productNameEn: tour.product?.nameEn || null,
          cityNameHe: loc?.nameHe || null,
          cityNameEn: loc?.nameEn || null,
          cityIsHome: loc ? !!loc.isHomeLocation : null,
          tourDate: tour.date,
          tourTime: tour.startTime,
          tourEventId: tour.id,
          // #13 announces a NEW customer on an open tour, so it links to THAT
          // customer's coordination form.
          formUrl: booking ? await staffFormLinkUrl({
            purpose: 'coordination', subjectType: 'booking', subjectId: booking.id,
          }, { db: client, log }) : null,
        },
      },
    }, log);
    if (r?.ok) fired.push(a.externalPersonId);
  }
  return { fired };
}
