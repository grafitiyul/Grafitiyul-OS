// Organizations PROVEN to belong to a set of contacts (ContactOrganization
// links), deduplicated, primary-first.
//
// This is the only kind of organization suggestion GOS is willing to make: a
// real, existing membership. Nothing is ever guessed from a deal title, a
// contact's name, an email domain, a phone number or a previous deal — a wrong
// organization on a quote is a business document sent to the wrong customer.
//
// `contacts` are full contact payloads (GET /api/contacts/:id), which carry
// `orgLinks: [{ isPrimary, organization: {id,name}, organizationUnit }]`.
export function contactOrganizationSuggestions(contacts = []) {
  const rows = [];
  for (const c of contacts) {
    for (const link of c?.orgLinks || []) {
      if (!link?.organization?.id) continue;
      rows.push({
        id: link.organization.id,
        name: link.organization.name || '',
        isPrimary: !!link.isPrimary,
        unitId: link.organizationUnit?.id || null,
        unitName: link.organizationUnit?.name || null,
        contactName: c.fullNameHe || c.fullNameEn || '',
      });
    }
  }
  const seen = new Set();
  const out = [];
  // Stable sort: primary memberships first, contact order preserved otherwise.
  for (const r of [...rows].sort((a, b) => (b.isPrimary === true) - (a.isPrimary === true))) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
