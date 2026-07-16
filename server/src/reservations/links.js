// Travel Agency Reservations — permanent per-agent capability links.
// See docs/architecture/GOS-travel-agent-reservation-module-plan.md.
//
// Token contract (GOS-native, same as portalToken / QuestionnaireLink /
// TourGalleryLink): 24-byte base64url, exact-match resolve, unknown/revoked
// token → not_found (never reveals existence), valid-but-disabled → disabled
// (a deliberate, debuggable admin signal). Rotation = revoke + mint new row.
//
// Eligibility is a LIVE check, not a mint-time snapshot: the contact must
// CURRENTLY belong to an Organization whose OrganizationType carries the
// agentReservations capability flag ("סוכנויות תיירות ונסיעות" in settings).
// A contact detached from every qualifying organization makes the permanent
// link fail safely (not_eligible → 403) without deleting anything.

import crypto from 'node:crypto';
import { prisma } from '../db.js';

export function newReservationToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Include shape needed by eligibleAgencyOrg — the contact's org memberships
// with each organization's type (for the capability flag).
export const ELIGIBILITY_INCLUDE = {
  orgLinks: {
    include: {
      organization: { include: { organizationType: true } },
    },
  },
};

// The qualifying agency organization for a contact (loaded with
// ELIGIBILITY_INCLUDE), or null when the contact is not eligible. The primary
// membership wins; otherwise the first qualifying link. This is also the
// organization a future Deal will be attached to (BINDING #2: the contact's
// CURRENT organization — derived live, never pinned on the link).
export function eligibleAgencyOrg(contact) {
  const qualifying = (contact?.orgLinks || []).filter(
    (l) => l.organization?.organizationType?.agentReservations,
  );
  if (!qualifying.length) return null;
  const primary = qualifying.find((l) => l.isPrimary);
  return (primary || qualifying[0]).organization;
}

// Resolve a public reservation token. Security contract (portal.js pattern):
//   * exact-match only (findUnique on token) — no fuzzy/newest lookup
//   * unknown OR revoked token → not_found (revoked reads as unknown so a
//     rotated-away link leaks nothing)
//   * valid but kill-switched (isEnabled=false) → disabled
//   * valid but contact no longer belongs to a qualifying agency →
//     not_eligible (fails safely; the link row is untouched)
// Exported for unit testing with an injectable `db`.
export async function resolveReservationLink(token, db = prisma) {
  if (!token || typeof token !== 'string') return { error: 'not_found' };
  const link = await db.agentReservationLink.findUnique({
    where: { token },
    include: { contact: { include: ELIGIBILITY_INCLUDE } },
  });
  if (!link) return { error: 'not_found' };
  if (link.status !== 'active') return { error: 'not_found' };
  if (!link.isEnabled) return { error: 'disabled', link };
  const organization = eligibleAgencyOrg(link.contact);
  if (!organization) return { error: 'not_eligible', link };
  return { link, contact: link.contact, organization };
}

// The single active link for a contact (at most one is enforced by the mint
// path; if legacy data ever holds several, the newest wins deterministically).
export async function activeLinkForContact(contactId, db = prisma) {
  const links = await db.agentReservationLink.findMany({
    where: { contactId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
  return links[0] || null;
}

// Mint a link for a contact. One active link per contact — minting while one
// exists returns the existing row (idempotent, no accidental rotation).
export async function mintLinkForContact(
  { contactId, createdById = null, label = null, defaultLanguage = 'he' },
  db = prisma,
) {
  const existing = await activeLinkForContact(contactId, db);
  if (existing) return { link: existing, created: false };
  const link = await db.agentReservationLink.create({
    data: {
      contactId,
      token: newReservationToken(),
      createdById,
      label,
      defaultLanguage: defaultLanguage === 'en' ? 'en' : 'he',
    },
  });
  return { link, created: true };
}

// Rotate: revoke the active link (reason 'rotated') and mint a fresh token in
// one transaction. The old URL dies immediately; audit rows are kept.
export async function rotateLinkForContact({ contactId, createdById = null }, db = prisma) {
  return db.$transaction(async (tx) => {
    const existing = await activeLinkForContact(contactId, tx);
    if (!existing) return { error: 'no_active_link' };
    await tx.agentReservationLink.update({
      where: { id: existing.id },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: 'rotated' },
    });
    const link = await tx.agentReservationLink.create({
      data: {
        contactId,
        token: newReservationToken(),
        createdById,
        label: existing.label,
        defaultLanguage: existing.defaultLanguage,
        isEnabled: existing.isEnabled,
      },
    });
    return { link, revokedId: existing.id };
  });
}

// Revoke without replacement (reason 'manual'). The contact keeps no link
// until an admin mints a new one.
export async function revokeLinkForContact(contactId, db = prisma) {
  const existing = await activeLinkForContact(contactId, db);
  if (!existing) return { error: 'no_active_link' };
  const link = await db.agentReservationLink.update({
    where: { id: existing.id },
    data: { status: 'revoked', revokedAt: new Date(), revokedReason: 'manual' },
  });
  return { link };
}
