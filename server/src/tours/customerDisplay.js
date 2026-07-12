// Customer identity for tour LIST/CALENDAR DTOs — ONE canonical resolver, no
// competing rules. It returns THREE explicit, separately-meaningful fields so
// no client surface has to guess:
//   - contactDisplayName      the primary person's name only  ("דור קורן")
//   - organizationDisplayName the organization name only       ("IBM")
//   - bookerDisplayName        the combined operational label  ("דור קורן · IBM")
//
// This deliberately REPLACES the old "customerDisplayName" that prioritized the
// organization and mislabeled it as the customer.
//
// These exist so list surfaces ship compact resolved STRINGS, never
// Deal/Contact/Organization payloads. Pure functions — unit-testable.

export function contactDisplayNameHe(c) {
  if (!c) return '';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  if (he) return he;
  return `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
}

// Per-deal fields. Expects the lean select the tour routes use:
// { title, organization: { name }, contacts: [{ contact: {…names} }] } with
// contacts already ordered primary-first.
export function dealContactName(deal) {
  return deal ? contactDisplayNameHe(deal.contacts?.[0]?.contact) : '';
}

export function dealOrganizationName(deal) {
  return deal?.organization?.name || '';
}

// The combined booker: "contact · organization", degrading to whichever exists.
// Last-resort deal title only when neither a contact nor an organization is
// present (a bare deal). Returns null when nothing at all resolves.
export function dealBookerLabel(deal) {
  const contact = dealContactName(deal);
  const org = dealOrganizationName(deal);
  if (contact && org) return `${contact} · ${org}`;
  return contact || org || deal?.title || null;
}

// Multi-booking tours → ONE deterministic identity. The caller passes bookings
// in a STABLE order (createdAt asc, id asc); the "primary" for each field is
// the FIRST booking that yields a non-empty value in that order (so a first
// booking missing a contact doesn't blank the column). additionalBookingCount
// = other bookings beyond the first, surfaced by the UI as "+N".
//   → { contactDisplayName, organizationDisplayName, bookerDisplayName,
//       additionalBookingCount }
export function resolveBookingsCustomerIdentity(bookings) {
  const list = (bookings || []).filter((b) => b && b.deal);
  const firstNonEmpty = (fn) => {
    for (const b of list) {
      const v = fn(b.deal);
      if (v) return v;
    }
    return null;
  };
  return {
    contactDisplayName: firstNonEmpty(dealContactName),
    organizationDisplayName: firstNonEmpty(dealOrganizationName),
    bookerDisplayName: firstNonEmpty(dealBookerLabel),
    additionalBookingCount: Math.max(0, list.length - 1),
  };
}

// "value +N" (or just "value", or null) — the ONE compaction the +N surfaces
// share, so the calendar (server-composed) and the table columns (client-
// composed) read identically.
export function withBookingCount(value, additionalBookingCount) {
  if (!value) return null;
  return additionalBookingCount > 0 ? `${value} +${additionalBookingCount}` : value;
}
