// THE nested-entity reference inside a search result.
//
// A search row often NAMES another entity: a deal row names its contact and its
// organization, a contact row names the organization it belongs to, a note row
// names whatever it was written on. Those names became interactive (hover to
// peek, click to open that entity instead of the row), and the moment they did,
// "which contact is this, and where does it live" had to have exactly ONE
// answer — otherwise the same person opens a different URL depending on which
// category surfaced them.
//
// So every provider builds these refs here. That also fixed a real
// inconsistency that predates the feature: the contacts provider addressed a
// contact by its public contactNo while the timeline provider addressed the
// same contact by cuid. Both resolve, but only one is the canonical link.
//
// A ref is deliberately tiny — id, name, path — because it rides on every row.
// The hover card's richer payload is fetched on demand (search/peek.js), once,
// for the one entity the operator actually pointed at.

import { fullNameHe, fullNameEn } from './text.js';

/** Public-number-first URL, cuid fallback for rows not yet backfilled. */
export const contactPath = (c) => `/admin/crm/contacts/${c?.contactNo ?? c?.id}`;
export const organizationPath = (o) => `/admin/crm/organizations/${o?.orgNo ?? o?.id}`;
export const dealPath = (d) => `/admin/crm/deals/${d?.orderNo ?? d?.id}`;

/** Select fragment every caller must use so a ref can always be built. */
export const CONTACT_REF_SELECT = {
  id: true, contactNo: true,
  firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
};
export const ORGANIZATION_REF_SELECT = { id: true, orgNo: true, name: true };

export function contactRef(contact) {
  if (!contact?.id) return null;
  const name = fullNameHe(contact) || fullNameEn(contact);
  if (!name) return null;
  return { type: 'contact', id: contact.id, name, path: contactPath(contact) };
}

/**
 * An organization reference, optionally qualified by the UNIT this particular
 * row is about. The unit rides along rather than becoming its own ref: a unit
 * has no page of its own, it is a detail OF the organization, and the peek card
 * shows it as such.
 */
export function organizationRef(org, unit = null) {
  if (!org?.id || !org.name) return null;
  return {
    type: 'organization',
    id: org.id,
    name: org.name,
    path: organizationPath(org),
    unitId: unit?.id || null,
    unitName: unit?.name || null,
  };
}
