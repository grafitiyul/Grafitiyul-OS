// Dedicated read models for the Guide Portal. The portal NEVER receives raw
// Deal/Booking rows — these builders whitelist operational fields and apply
// the server-resolved guide permissions. Anything commercial (deal value,
// quotes, collection, payments, CRM timeline, internal notes beyond
// customerInfo) simply has no path into these shapes.
//
// Pure functions — every builder takes already-fetched rows so the logic is
// unit-testable without a database.

const DEFAULT_TOUR_DURATION_HOURS = 3;

// TourEvent.kind IS the Deal's activity vocabulary (same mapping the admin
// header uses). The portal renders the Hebrew label client-side.
const KIND_TO_ACTIVITY = {
  private: 'private',
  business: 'business',
  group_slot: 'group',
};

function contactNameHe(c) {
  if (!c) return '';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  if (he) return he;
  return `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
}

// primary link = the customer; fieldRep = the fieldRep-role link ONLY when it
// is explicitly set AND a different person (same rule as the admin card).
function resolveCustomerContacts(dealContacts) {
  const links = dealContacts || [];
  const primary = links.find((l) => l.isPrimary) || links[0] || null;
  const fieldRep = links.find((l) => (l.roles || []).includes('fieldRep')) || null;
  return { primary, fieldRep };
}

// When does the tour END? date + startTime + variant duration (fallback 3h).
// Used for the upcoming/past split — a tour running right now is upcoming.
export function tourEndMs(tour) {
  const date = String(tour.date || '');
  const time = String(tour.startTime || '00:00');
  const startMs = Date.parse(`${date}T${time}:00`);
  if (Number.isNaN(startMs)) return Number.NaN;
  const hours = Number(tour.productVariant?.durationHours);
  const duration = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TOUR_DURATION_HOURS;
  return startMs + duration * 60 * 60 * 1000;
}

// The variant's full display name — product + location (a ProductVariant's
// identity is the product/location pair; it has no name of its own).
export function variantDisplayName(tour) {
  const product = tour.product?.nameHe || 'סיור';
  const location =
    tour.location?.nameHe || tour.productVariant?.location?.nameHe || null;
  return location ? `${product} · ${location}` : product;
}

// ---------- list card ----------

export function guideTourCardDto({ tour, assignment, occupancy, guideColor = null }) {
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
    variantName: variantDisplayName(tour),
    productName: tour.product?.nameHe || null,
    locationName: tour.location?.nameHe || tour.productVariant?.location?.nameHe || null,
    participantsTotal: occ.activeSeats || 0,
  };
}

// ---------- participant (booking) card ----------

export function guideParticipantDto(booking, permissions, { coordinationStatus = null, byProduct = [] } = {}) {
  const deal = booking.deal;
  if (!deal) return null;
  const { primary, fieldRep } = resolveCustomerContacts(deal.contacts);
  const customerName = contactNameHe(primary?.contact) || deal.title || null;
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
    // full name (spec). customerName still ships for the subtitle.
    title: deal.organization?.name || customerName || 'לקוח',
    customerName,
    organizationUnit: deal.organizationUnit?.name || null,
    // Display-only — the portal must NOT link to the Deal.
    orderNo: deal.orderNo ?? null,
    phone: permissions.viewParticipantPhone
      ? primary?.contact?.phones?.[0]?.value || null
      : null,
    email: permissions.viewParticipantEmail
      ? primary?.contact?.emails?.[0]?.value || null
      : null,
    fieldRepName: showFieldRep ? contactNameHe(fieldRep.contact) || null : null,
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
export function guideHeldParticipantDto(reg, permissions, { byProduct = [] } = {}) {
  const deal = reg.deal;
  const primary = deal ? resolveCustomerContacts(deal.contacts).primary : null;
  const customerName = contactNameHe(primary?.contact) || deal?.title || reg.customerName || 'לקוח';
  return {
    registrationId: reg.id,
    held: true,
    badge: 'עוד לא סופי',
    seats: reg.quantity,
    // Same canonical composition as a confirmed row (shared DTO).
    byProduct,
    title: deal?.organization?.name || customerName || 'לקוח',
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

// ---------- tour detail ----------

export function guideTourDetailDto({
  tour,
  assignment,
  occupancy,
  permissions,
  coordinationStatusByBooking = {},
  heldRegistrations = [],
  participantBreakdown = null,
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
    variantName: variantDisplayName(tour),
    productName: tour.product?.nameHe || null,
    locationName: tour.location?.nameHe || tour.productVariant?.location?.nameHe || null,
    notes: tour.notes || null, // operational tour note, not CRM
    viewerRole: assignment?.role || null,
    participantsTotal: occ.activeSeats || 0,
    team: permissions.viewTeam
      ? (tour.assignments || []).map((a) => ({
          id: a.id,
          displayName: a.displayName,
          role: a.role,
          imageUrl: a.personRef?.profile?.imageUrl || null,
        }))
      : null, // null = hidden by permissions (client renders nothing)
    // ALL activity components — drive the "מרכיבי הפעילות" chips (workshop or
    // not). Location is NOT carried here; the portal reads it from the
    // dedicated workshopLocations list below.
    components: (tour.activityComponents || []).map((row) => ({
      id: row.id,
      nameHe: row.activityComponent?.nameHe || '',
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
        nameHe: row.activityComponent?.nameHe || '',
        icon: row.activityComponent?.icon || null,
        location: {
          nameHe: row.workshopLocation.nameHe,
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
        }),
      )
      .filter(Boolean),
    // Conditional (HELD) reservations — "probably coming, not yet confirmed".
    // Expired/cancelled holds are never fetched, so they vanish from the portal.
    provisionalParticipants: (heldRegistrations || []).map((r) =>
      guideHeldParticipantDto(r, permissions, { byProduct: byProductByReg.get(r.id) || [] }),
    ),
  };
}
