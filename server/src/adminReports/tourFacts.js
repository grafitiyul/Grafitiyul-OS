// Tour facts the guide notifications render — pulled from canonical sources
// only, and shaped once so #12/#14/#15/#16 all say the same things the same way.

/** The deal's primary contact name (Hebrew, falling back to English). */
export const dealContactName = (deal) => {
  const c = deal?.contacts?.[0]?.contact;
  if (!c) return null;
  return `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim()
    || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || null;
};
const contactName = dealContactName;

/** "Organization" if there is one, else the contact's name — the customer label. */
export function tourCustomerLabel(tour) {
  const deal = tour?.bookings?.[0]?.deal;
  if (!deal) return null;
  return deal.organization?.name || contactName(deal) || null;
}

/** The shared fact block every per-tour guide notification renders from. */
export function tourNotificationFacts(tour) {
  const loc = tour.location || tour.productVariant?.location || null;
  return {
    tourEventId: tour.id,
    tourDate: tour.date,
    tourTime: tour.startTime,
    // He/En PAIR naming on purpose (productNameHe/productNameEn) — the
    // bilingual guard recognizes pairs by this convention and verifies each
    // report shows its own language's side.
    productNameHe: tour.product?.nameHe || null,
    productNameEn: tour.product?.nameEn || null,
    cityNameHe: loc?.nameHe || null,
    cityNameEn: loc?.nameEn || null,
    // Canonical home flag (Location.isHomeLocation) — the renderers show the
    // city ONLY when the tour is away from home. Null when the select did not
    // carry the flag, which reads as "not known to be home" (city shows).
    cityIsHome: loc && loc.isHomeLocation !== undefined ? !!loc.isHomeLocation : null,
    locationId: tour.locationId ?? tour.productVariant?.locationId ?? null,
    customerName: tourCustomerLabel(tour),
    orgName: tour.bookings?.[0]?.deal?.organization?.name || null,
    contactName: contactName(tour.bookings?.[0]?.deal),
    participants: tour.bookings?.[0]?.deal?.participants ?? null,
  };
}

// (The old openTourParticipants breakdown left with the per-tour open-tour
// message: #12 is per BOOKING on every tour kind, so the whole-tour customer
// list is no longer part of any guide notification.)
