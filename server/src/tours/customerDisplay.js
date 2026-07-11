// Compact customer labels for tour LIST/CALENDAR DTOs — the resolution rule
// is the SAME one the guide portal card uses (guidePortal/dto.js):
//   organization name → primary contact's name → deal title.
// These helpers exist so list surfaces ship ONE resolved string instead of
// Deal/Contact/Organization payloads. Pure functions — unit-testable.

export function contactDisplayNameHe(c) {
  if (!c) return '';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  if (he) return he;
  return `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
}

// One deal → one compact label. Expects the lean select the tour routes use:
// { title, organization: { name }, contacts: [{ contact: {…names} }] } where
// contacts is already ordered primary-first (isPrimary desc, createdAt asc).
export function dealCustomerLabel(deal) {
  if (!deal) return null;
  if (deal.organization?.name) return deal.organization.name;
  const name = contactDisplayNameHe(deal.contacts?.[0]?.contact);
  return name || deal.title || null;
}

// Multi-booking tours (group slots) → one deterministic compact summary:
// the FIRST booking's label (bookings ordered createdAt asc — stable) plus a
// "+N" for the rest. Never an arbitrary pick, never a payload.
export function bookingsCustomerSummary(bookings) {
  const labels = (bookings || []).map((b) => dealCustomerLabel(b.deal)).filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1}`;
}

// Organization column (table): DISTINCT organization names across active
// bookings, same first+N compaction. Null when no booking has an org.
export function bookingsOrganizationSummary(bookings) {
  const names = [];
  for (const b of bookings || []) {
    const n = b.deal?.organization?.name;
    if (n && !names.includes(n)) names.push(n);
  }
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}
