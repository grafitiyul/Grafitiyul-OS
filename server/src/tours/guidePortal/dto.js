// Dedicated read models for the Guide Portal. The portal NEVER receives raw
// Deal/Booking rows — these builders whitelist operational fields and apply
// the server-resolved guide permissions. Anything commercial (deal value,
// quotes, collection, payments, CRM timeline, internal notes beyond
// customerInfo) simply has no path into these shapes.
//
// Pure functions — every builder takes already-fetched rows so the logic is
// unit-testable without a database.

import { resolveStaffDisplayName } from '../../../../shared/staffAssignmentDisplay.mjs';
import { catalogName, contactFullName } from '../../../../shared/bilingualText.mjs';
import { tourEndMs as canonicalTourEndMs } from '../tourTime.js';
import { stripTrailingSameDate } from '../calendar/desiredState.js';

// TourEvent.kind IS the Deal's activity vocabulary (same mapping the admin
// header uses). The portal renders the Hebrew label client-side.
const KIND_TO_ACTIVITY = {
  private: 'private',
  business: 'business',
  group_slot: 'group',
};

// A customer's name in the READER's language, through the canonical bilingual
// resolver (a Contact stores both name pairs). Names are business data — this
// only chooses between what a human already entered.
function contactName(c, lang) {
  return contactFullName(c, lang);
}

// primary link = the customer; fieldRep = the fieldRep-role link ONLY when it
// is explicitly set AND a different person (same rule as the admin card).
function resolveCustomerContacts(dealContacts) {
  const links = dealContacts || [];
  const primary = links.find((l) => l.isPrimary) || links[0] || null;
  const fieldRep = links.find((l) => (l.roles || []).includes('fieldRep')) || null;
  return { primary, fieldRep };
}

// When does the tour END? Delegates to the CANONICAL tours/tourTime.js — this
// used to be a second implementation with a 3h fallback that ignored the
// open-tour duration override and parsed the wall time in the SERVER's zone
// (UTC in production), skewing every end by 2–3 hours. Kept as a re-export so
// the portal's upcoming/past split and the notifications agree by construction.
// NaN (not null) is preserved for undated tours — the callers compare with `<`.
export function tourEndMs(tour) {
  const ms = canonicalTourEndMs(tour);
  return ms == null ? Number.NaN : ms;
}

// The tour's LOCATION name in the reader's language (Location carries the
// canonical nameHe/nameEn pair). The tour's own location wins over the
// variant's, exactly as before.
export function tourLocationName(tour, lang) {
  return (
    catalogName(tour.location, lang) ||
    catalogName(tour.productVariant?.location, lang) ||
    null
  );
}

// The variant's full display name — product + location (a ProductVariant's
// identity is the product/location pair; it has no name of its own). Both
// halves resolve through the canonical bilingual picker, so an English guide
// sees "Graffiti Tour · Florentin" wherever the catalog has English.
//
// Legacy-imported tours have NO product (class D by import decision); their
// operational identity is the legacy tour NAME stored as the first line of
// notes — the SAME canonical rule the calendar titles use (desiredState.js),
// including the trailing same-date strip. That note is free text in ONE
// language and ships verbatim; it is never translated in code.
//
// Returns null when nothing at all identifies the tour — the client renders
// the generic "tour" wording from its own language registry, so the last
// resort is not a hard-coded Hebrew word on the wire.
export function variantDisplayName(tour, lang) {
  const location = tourLocationName(tour, lang);
  const name =
    catalogName(tour.product, lang) ||
    stripTrailingSameDate(
      String(tour.notes || '').trim().split('\n')[0].slice(0, 80),
      tour.date,
    ) ||
    null;
  if (!name) return location || null;
  return location ? `${name} · ${location}` : name;
}

// Operational notes for the detail card. On a product-less legacy tour the
// notes FIRST LINE is the tour's display identity (variantDisplayName above)
// — when that's ALL the notes contain, there is no actual note to show and
// rendering it would duplicate the title. Multi-line notes keep everything
// (the name line included, so nothing is ever hidden), and native tours with
// a product always show their notes untouched.
export function operationalNotes(tour) {
  const raw = String(tour.notes || '').trim();
  if (!raw) return null;
  if (tour.product?.nameHe) return raw;
  return raw.includes('\n') ? raw : null;
}

// ---------- list card ----------

export function guideTourCardDto({ tour, assignment, occupancy, guideColor = null, lang = 'he' }) {
  const occ = occupancy || { activeSeats: 0, activeBookings: 0 };
  return {
    // Derived identity accent (canonical resolver, computed by the route) —
    // only the palette key ships, never other guides' profile data.
    guideColor,
    id: tour.id,
    date: tour.date,
    startTime: tour.startTime,
    status: tour.status, // scheduled | completed | cancelled
    activityType: KIND_TO_ACTIVITY[tour.kind] || tour.kind,
    tourLanguage: tour.tourLanguage,
    role: assignment?.role || null,
    variantName: variantDisplayName(tour, lang),
    productName: catalogName(tour.product, lang) || null,
    locationName: tourLocationName(tour, lang),
    participantsTotal: occ.activeSeats || 0,
  };
}

// ---------- participant (booking) card ----------

export function guideParticipantDto(
  booking,
  permissions,
  { coordinationStatus = null, byProduct = [], lang = 'he' } = {},
) {
  const deal = booking.deal;
  if (!deal) return null;
  const { primary, fieldRep } = resolveCustomerContacts(deal.contacts);
  const customerName = contactName(primary?.contact, lang) || deal.title || null;
  const showFieldRep =
    permissions.viewFieldRep && fieldRep && fieldRep !== primary && fieldRep.contact;
  return {
    bookingId: booking.id,
    status: booking.status,
    seats: booking.seats,
    // Canonical purchased composition (product → ticket types) — the SAME shape
    // the admin tour modal renders (shared participants.js DTO). Empty for a
    // legacy/website row with no breakdown; the client then shows seats.
    byProduct,
    // Primary title: organization if it exists, otherwise the customer's
    // full name (spec). customerName still ships for the subtitle. Both are
    // real business values; when neither exists the DTO ships null and the
    // client renders the generic "customer" wording in the guide's language.
    title: deal.organization?.name || customerName || null,
    customerName,
    // "שם הקבוצה" (agent reservations, BINDING #6) — rendered above the
    // participant cards on the portal tour page.
    groupName: deal.groupName || null,
    organizationUnit: deal.organizationUnit?.name || null,
    // Display-only — the portal must NOT link to the Deal.
    orderNo: deal.orderNo ?? null,
    phone: permissions.viewParticipantPhone
      ? primary?.contact?.phones?.[0]?.value || null
      : null,
    email: permissions.viewParticipantEmail
      ? primary?.contact?.emails?.[0]?.value || null
      : null,
    fieldRepName: showFieldRep ? contactName(fieldRep.contact, lang) || null : null,
    // Admin-authored rich HTML (same trusted origin as the admin card).
    customerInfo: permissions.viewCustomerInfo ? deal.customerInfo || null : null,
    // Coordination questionnaire state for THIS booking — null when the
    // permission is off (the button simply doesn't render).
    coordinationStatus: permissions.useCoordinationForms ? coordinationStatus : null,
  };
}

// ---------- provisional (HELD) participant card ----------
// A conditional reservation the guide should be AWARE of ("probably coming"),
// but which is NOT a confirmed customer. Server-enforced restriction: phone,
// email, field rep and coordination NEVER ship for a held row — regardless of
// permissions. Only name + count + Important Customer Information + the badge.
export function guideHeldParticipantDto(reg, permissions, { byProduct = [], lang = 'he' } = {}) {
  const deal = reg.deal;
  const primary = deal ? resolveCustomerContacts(deal.contacts).primary : null;
  const customerName =
    contactName(primary?.contact, lang) || deal?.title || reg.customerName || null;
  return {
    registrationId: reg.id,
    held: true,
    // Badge identity, not wording — the client owns "עוד לא סופי" / "Not
    // confirmed yet" in its language registry.
    badgeKey: 'not_final',
    seats: reg.quantity,
    // Same canonical composition as a confirmed row (shared DTO).
    byProduct,
    title: deal?.organization?.name || customerName || null,
    customerName,
    // Important Customer Information — same permission gate as a confirmed row.
    customerInfo: permissions.viewCustomerInfo ? deal?.customerInfo || null : null,
    // HELD is probable, not confirmed → NO contact channel / coordination action,
    // even if the guide has those permissions. Enforced HERE, not in the client.
    phone: null,
    email: null,
    fieldRepName: null,
    coordinationStatus: null,
  };
}

// ---------- parallel tours (operational summary) ----------
// The guide-safe shape for a tour happening at ~the same time. Built from the
// canonical parallelTours selector's core rows, which already contain NO
// customer data (only operational tour fields + staff display names). This
// builder additionally enforces the portal's direct-access rule:
//   `viewable` is true ONLY when this guide has an active TourAssignment on
//   that parallel tour. A non-viewable row ships NO id, so the client cannot
//   construct a /p/:token/tour/:id link to it — and the detail route enforces
//   the same assignment rule server-side regardless (this is a UI hint, not the
//   gate). Never ships participants, deals, notes or contact channels.
export function guideParallelToursDto(rows, { viewableIds } = {}) {
  const viewable = viewableIds instanceof Set ? viewableIds : new Set(viewableIds || []);
  return (rows || []).map((r) => {
    const canOpen = viewable.has(r.id);
    return {
      id: canOpen ? r.id : null, // id only for a tour this guide may actually open
      viewable: canOpen,
      date: r.date,
      startTime: r.startTime,
      status: r.status,
      variantName: r.variantName,
      productName: r.productName,
      locationName: r.locationName,
      participantsTotal: r.participantCount, // aggregate count only, never identities
      staff: r.staff, // staff display names only (never customers)
    };
  });
}

// ---------- tour detail ----------

export function guideTourDetailDto({
  tour,
  assignment,
  occupancy,
  permissions,
  coordinationStatusByBooking = {},
  heldRegistrations = [],
  participantBreakdown = null,
  lang = 'he',
}) {
  const occ = occupancy || { activeSeats: 0, activeBookings: 0 };
  // Route each customer's canonical composition to its card by stable key
  // (bookingId for confirmed, registrationId for held) — the SAME participants.js
  // DTO the admin modal uses. No parallel breakdown logic in the portal.
  const byProductByBooking = new Map();
  const byProductByReg = new Map();
  for (const c of participantBreakdown?.customers || []) {
    if (c.bookingId) byProductByBooking.set(c.bookingId, c.byProduct);
    byProductByReg.set(c.registrationId, c.byProduct);
  }
  return {
    // Grouped aggregate (product → ticket types) above the participant cards.
    participantBreakdown: participantBreakdown?.aggregate || null,
    id: tour.id,
    date: tour.date,
    startTime: tour.startTime,
    durationHours: tour.productVariant?.durationHours ?? null,
    status: tour.status,
    activityType: KIND_TO_ACTIVITY[tour.kind] || tour.kind,
    tourLanguage: tour.tourLanguage,
    variantName: variantDisplayName(tour, lang),
    productName: catalogName(tour.product, lang) || null,
    locationName: tourLocationName(tour, lang),
    notes: operationalNotes(tour), // operational tour note, not CRM
    viewerRole: assignment?.role || null,
    participantsTotal: occ.activeSeats || 0,
    team: permissions.viewTeam
      ? (tour.assignments || []).map((a) => ({
          id: a.id,
          displayName: resolveStaffDisplayName(a, lang),
          role: a.role,
          imageUrl: a.personRef?.profile?.imageUrl || null,
        }))
      : null, // null = hidden by permissions (client renders nothing)
    // ALL activity components — drive the "מרכיבי הפעילות" chips (workshop or
    // not). Location is NOT carried here; the portal reads it from the
    // dedicated workshopLocations list below.
    components: (tour.activityComponents || []).map((row) => ({
      id: row.id,
      // ActivityComponent maintains nameHe/nameEn — resolved through the ONE
      // bilingual picker. The key is `name` (already language-resolved), never
      // a language-specific key the client would have to choose between.
      name: catalogName(row.activityComponent, lang) || '',
      icon: row.activityComponent?.icon || null,
      color: row.activityComponent?.color || null,
      isWorkshop: !!row.activityComponent?.isWorkshop,
    })),
    // ONLY workshop components that have a real assigned location — the portal
    // is read-only, so a workshop still awaiting an admin location has nothing
    // to show and must produce no row/placeholder. "בחירת מיקום…" is an admin
    // editing affordance and never reaches the portal. The client re-applies
    // this filter defensively.
    workshopLocations: (tour.activityComponents || [])
      .filter((row) => row.activityComponent?.isWorkshop && row.workshopLocation)
      .map((row) => ({
        id: row.id,
        name: catalogName(row.activityComponent, lang) || '',
        icon: row.activityComponent?.icon || null,
        // WorkshopLocation has NO English columns anywhere in GOS (name,
        // address and access instructions are single-language). These ship
        // VERBATIM — never machine-translated — and the gap is reported by
        // scripts/reportPortalEnglishGaps.js so it can be fixed in the data.
        location: {
          name: row.workshopLocation.nameHe,
          address: row.workshopLocation.address || null,
          instructions: row.workshopLocation.instructions || null,
        },
      })),
    participants: (tour.bookings || [])
      .filter((b) => b.status !== 'cancelled')
      .map((b) =>
        guideParticipantDto(b, permissions, {
          coordinationStatus: coordinationStatusByBooking[b.id] || null,
          byProduct: byProductByBooking.get(b.id) || [],
          lang,
        }),
      )
      .filter(Boolean),
    // Conditional (HELD) reservations — "probably coming, not yet confirmed".
    // Expired/cancelled holds are never fetched, so they vanish from the portal.
    provisionalParticipants: (heldRegistrations || []).map((r) =>
      guideHeldParticipantDto(r, permissions, { byProduct: byProductByReg.get(r.id) || [], lang }),
    ),
  };
}
