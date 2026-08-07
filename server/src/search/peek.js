// The hover-card payload for a nested entity reference in a search result.
//
// Deliberately NOT the full CRM record. Pointing at a name must cost one small,
// bounded read — the operator is checking "is this the right person", not
// opening the card. So this returns exactly what the hover card renders and
// nothing else, from a single query per entity.
//
// Read-only by construction, like the WhatsApp conversation peek: no write, no
// "viewed" stamp, no side effect of any kind. Looking is free.
//
// One module for both entity types so the two cards can never drift into
// answering the same question differently.

import { prisma } from '../db.js';
import { contactPath, organizationPath } from './entityRefs.js';
import { fullNameHe, fullNameEn } from './text.js';

export const PEEK_TYPES = ['contact', 'organization'];

// Enough to recognise a person, not enough to be a record page. A contact with
// five phone numbers is real; showing all five turns a hover into a wall.
const MAX_PHONES = 3;
const MAX_EMAILS = 2;
const MAX_ORGS = 3;

async function contactPeek(id, db) {
  const c = await db.contact.findUnique({
    where: { id },
    select: {
      id: true, contactNo: true,
      firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
      phones: { select: { value: true, label: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
      emails: { select: { value: true, label: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
      orgLinks: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          isPrimary: true, role: true,
          organization: { select: { id: true, orgNo: true, name: true } },
          organizationUnit: { select: { id: true, name: true } },
        },
      },
      _count: { select: { dealContacts: true } },
    },
  });
  if (!c) return null;

  const orgs = (c.orgLinks || [])
    .filter((l) => l.organization)
    .map((l) => ({
      id: l.organization.id,
      name: l.organization.name,
      path: organizationPath(l.organization),
      unitName: l.organizationUnit?.name || null,
      role: l.role || null,
      isPrimary: !!l.isPrimary,
    }));

  return {
    type: 'contact',
    id: c.id,
    path: contactPath(c),
    // Both names travel: a bilingual contact is one person, and which script
    // the operator recognises them by is not ours to decide.
    nameHe: fullNameHe(c) || null,
    nameEn: fullNameEn(c) || null,
    phones: (c.phones || []).slice(0, MAX_PHONES).map((p) => ({ value: p.value, label: p.label || null })),
    emails: (c.emails || []).slice(0, MAX_EMAILS).map((e) => ({ value: e.value, label: e.label || null })),
    // The primary link leads; the rest are shown compactly and counted, so a
    // person linked to eight organizations reads as "and 5 more", not as eight
    // lines of hover.
    organizations: orgs.slice(0, MAX_ORGS),
    moreOrganizations: Math.max(0, orgs.length - MAX_ORGS),
    dealCount: c._count?.dealContacts ?? 0,
  };
}

async function organizationPeek(id, db) {
  const o = await db.organization.findUnique({
    where: { id },
    select: {
      id: true, orgNo: true, name: true,
      organizationType: { select: { label: true } },
      units: { select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } },
      _count: { select: { deals: true, contactLinks: true } },
    },
  });
  if (!o) return null;

  return {
    type: 'organization',
    id: o.id,
    path: organizationPath(o),
    name: o.name,
    // Organization TYPE belongs to the organization. SUBTYPE does not — the
    // schema puts it on the Deal — so it is never read from here; the row that
    // opened this card supplies it when its own deal has one.
    typeLabel: o.organizationType?.label || null,
    units: (o.units || []).slice(0, MAX_ORGS).map((u) => ({ id: u.id, name: u.name })),
    moreUnits: Math.max(0, (o.units || []).length - MAX_ORGS),
    dealCount: o._count?.deals ?? 0,
    contactCount: o._count?.contactLinks ?? 0,
  };
}

/** One entity's hover payload, or null when it no longer exists. */
export async function loadPeek(type, id, { db = prisma } = {}) {
  if (!id || !PEEK_TYPES.includes(type)) return null;
  return type === 'contact' ? contactPeek(id, db) : organizationPeek(id, db);
}
