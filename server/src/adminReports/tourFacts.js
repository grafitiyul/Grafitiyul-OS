// Tour facts the guide notifications render — pulled from canonical sources
// only, and shaped once so #12/#14/#15/#16 all say the same things the same way.

import { prisma } from '../db.js';
import {
  fetchTourParticipantRegistrations, tourParticipantBreakdown,
} from '../tours/participants.js';

const contactName = (deal) => {
  const c = deal?.contacts?.[0]?.contact;
  if (!c) return null;
  return `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim()
    || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || null;
};

/** "Organization" if there is one, else the contact's name — the customer label. */
export function tourCustomerLabel(tour) {
  const deal = tour?.bookings?.[0]?.deal;
  if (!deal) return null;
  return deal.organization?.name || contactName(deal) || null;
}

/** The shared fact block every per-tour guide notification renders from. */
export function tourNotificationFacts(tour) {
  return {
    tourEventId: tour.id,
    tourDate: tour.date,
    tourTime: tour.startTime,
    productName: tour.product?.nameHe || null,
    cityName: tour.location?.nameHe || tour.productVariant?.location?.nameHe || null,
    locationId: tour.locationId ?? tour.productVariant?.locationId ?? null,
    customerName: tourCustomerLabel(tour),
    orgName: tour.bookings?.[0]?.deal?.organization?.name || null,
    contactName: contactName(tour.bookings?.[0]?.deal),
    participants: tour.bookings?.[0]?.deal?.participants ?? null,
  };
}

/**
 * Every booking/customer holding seats on an open tour, with their counts —
 * through the CANONICAL participant builder (never a hand-rolled query), so the
 * notification agrees with the admin tour modal and the guide portal.
 */
export async function openTourParticipants(tourEventId, client = prisma) {
  const rows = await fetchTourParticipantRegistrations(client, [tourEventId]);
  const { aggregate, customers } = tourParticipantBreakdown(rows);
  return {
    total: aggregate?.total ?? 0,
    customers: (customers || []).map((c) => ({ label: c.label, count: c.total, held: c.held })),
  };
}
