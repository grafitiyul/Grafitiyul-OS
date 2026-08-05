// Pure helpers for CreateDealModal's preset-contact mode ("פתיחת דיל חדש"
// from a Contact page). Kept as plain JS so the logic is testable with the
// node test runner without bundling JSX.

// Display name for the preset-contact box + the auto-derived deal title.
// Hebrew name wins; a Latin-only contact falls back to the English pair —
// the same precedence every other CRM surface uses.
export function contactDisplayName(c) {
  if (!c) return '';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  const en = `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
  return he || en;
}

// The organization to preselect when opening a deal from a contact: the
// contact's PRIMARY org link when one is marked, else the first link, else
// null (no org section pre-opened). Only genuinely linked organizations —
// never inferred from names or deals.
export function presetOrgForContact(c) {
  const links = Array.isArray(c?.orgLinks) ? c.orgLinks : [];
  const link =
    links.find((l) => l?.isPrimary && l?.organization) ||
    links.find((l) => l?.organization);
  return link ? { id: link.organization.id, name: link.organization.name } : null;
}
