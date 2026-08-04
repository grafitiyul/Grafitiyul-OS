// Ingress Platform — THE identity resolution layer.
//
// Turns a normalized event into real GOS records: which Contact is this, which
// Organization (if any), and is there already a live conversation with them.
// Every source resolves identity through this one module — an adapter never
// touches Contact/Organization/Deal.
//
// Phone matching reuses search/phoneQuery.js (which itself reuses the canonical
// normalizePhoneIntl). Candidate rows are narrowed in SQL by the 9 significant
// trailing digits — the one fragment present in EVERY stored spelling of a
// number — then confirmed with canonical equality. No second notion of "same
// number" is introduced anywhere.
//
// Nothing here rewrites stored data: an existing ContactPhone is never
// reformatted, matching is read-only. New channels are appended, never replaced.

import { significantDigits, isExactPhoneMatch } from '../search/phoneQuery.js';
import { lookupPhoneContacts } from '../search/lookups.js';

// Ambiguity policy. A number owned by exactly one contact resolves to that
// contact. When several contacts share it (a shared office line), we do NOT
// invent a third contact — that would guarantee a duplicate. We attach to the
// most recently updated one and mark the event `identityAmbiguous`, so the
// guess is visible to a human on the deal rather than silent. This is the one
// place the platform makes a judgement call, and it is deliberately loud.
// Candidate narrowing REUSES the canonical lookupPhoneContacts: stored phone
// values keep whatever formatting a human typed ('050-123-4567'), so narrowing
// must strip separators in SQL (regexp_replace ... LIKE '%significant'). A
// naive `contains` on the raw column silently misses every formatted number —
// the exact defect this reuse prevents.
export async function findContactByPhone(db, phoneIntl) {
  if (!phoneIntl) return { contactId: null, ambiguous: false };
  const significant = significantDigits(phoneIntl);
  if (!significant) return { contactId: null, ambiguous: false };

  const found = await lookupPhoneContacts({ kind: 'exact', intl: phoneIntl, significant }, db);
  // Only canonical-equal numbers count as identity; suffix-only hits are a
  // different subscriber and must never merge two people.
  const exactIds = [...found.entries()].filter(([, v]) => v.exact).map(([contactId]) => contactId);
  if (exactIds.length === 0) return { contactId: null, ambiguous: false };
  if (exactIds.length === 1) return { contactId: exactIds[0], ambiguous: false };

  const contacts = await db.contact.findMany({
    where: { id: { in: exactIds } },
    select: { id: true, updatedAt: true },
  });
  contacts.sort((a, b) => (b.updatedAt?.getTime?.() || 0) - (a.updatedAt?.getTime?.() || 0));
  return { contactId: contacts[0]?.id || exactIds[0], ambiguous: true };
}

// Email matching is exact on the normalized (lowercased) value. Case-insensitive
// compare is done in SQL so an address stored as typed still matches.
export async function findContactByEmail(db, email) {
  if (!email) return { contactId: null, ambiguous: false };
  const rows = await db.contactEmail.findMany({
    where: { value: { equals: email, mode: 'insensitive' } },
    select: { contactId: true },
    take: 50,
  });
  const unique = [...new Set(rows.map((r) => r.contactId))];
  if (unique.length === 0) return { contactId: null, ambiguous: false };
  if (unique.length === 1) return { contactId: unique[0], ambiguous: false };
  return { contactId: unique[0], ambiguous: true };
}

// Phone first, email second — the same precedence the business already uses
// (a mobile identifies a person; an inbox can be shared).
export async function resolveContact(db, normalized) {
  const byPhone = await findContactByPhone(db, normalized.person.phoneIntl);
  if (byPhone.contactId) return { ...byPhone, matchedBy: 'phone' };
  const byEmail = await findContactByEmail(db, normalized.person.email);
  if (byEmail.contactId) return { ...byEmail, matchedBy: 'email' };
  return { contactId: null, ambiguous: false, matchedBy: null };
}

// Create a Contact from a normalized event. Phone/email are written in the form
// a human would have typed (local 0-prefix for Israeli numbers).
export async function createContactFrom(db, normalized) {
  const { firstName, lastName, phoneDisplay, email, language } = normalized.person;
  return db.contact.create({
    data: {
      firstNameHe: firstName || normalized.person.displayName || 'ליד',
      lastNameHe: lastName || '',
      firstNameEn: '',
      lastNameEn: '',
      communicationLanguage: language || null,
      phones: phoneDisplay ? { create: [{ value: phoneDisplay, isPrimary: true }] } : undefined,
      emails: email ? { create: [{ value: email, isPrimary: true }] } : undefined,
    },
    select: { id: true },
  });
}

// Append any channel the event carries that the contact does not already have.
// Never overwrites, never re-primaries — a lead must not silently change how
// the office already reaches someone.
export async function enrichContactChannels(db, contactId, normalized) {
  const added = { phone: false, email: false };
  const { phoneIntl, phoneDisplay, email } = normalized.person;

  if (phoneDisplay && phoneIntl) {
    const existing = await db.contactPhone.findMany({
      where: { contactId },
      select: { value: true },
    });
    if (!existing.some((p) => isExactPhoneMatch(p.value, phoneIntl))) {
      await db.contactPhone.create({
        data: { contactId, value: phoneDisplay, isPrimary: existing.length === 0 },
      });
      added.phone = true;
    }
  }

  if (email) {
    const existing = await db.contactEmail.findMany({
      where: { contactId },
      select: { value: true },
    });
    if (!existing.some((e) => String(e.value).toLowerCase() === email)) {
      await db.contactEmail.create({
        data: { contactId, value: email, isPrimary: existing.length === 0 },
      });
      added.email = true;
    }
  }
  return added;
}

// Organization resolution is match-only by exact (case-insensitive) name. The
// platform deliberately does NOT create organizations from an inbound lead:
// org identity carries billing and classification consequences, and a typo in a
// web form must never mint a new business entity. An unmatched name is kept on
// the deal as free text for a human to link.
export async function resolveOrganization(db, normalized) {
  const name = normalized.organization?.name;
  if (!name) return { organizationId: null, matchedBy: null };
  const rows = await db.organization.findMany({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  });
  if (rows.length === 1) return { organizationId: rows[0].id, matchedBy: 'name' };
  return { organizationId: null, matchedBy: null };
}

// The live-conversation probe behind the dedupe decision: does this contact
// already have an OPEN deal? Replaces the legacy implementation's
// create-filter → list → delete-filter dance against Pipedrive with a direct
// indexed query.
/**
 * THE stable order identity → Deal resolution.
 *
 * An external ORDER has a durable identity of its own — (store, provider order
 * id) — that is completely independent of its status and of anything mutable on
 * it. Every later delivery for that order must reach the SAME Deal: pending →
 * processing → completed is one purchase, not three.
 *
 * The crosswalk is the IngressEvent ledger itself rather than a new table: it
 * already records (source, sourceKey, externalId) → dealId for every processed
 * event, it is written in the same transaction as the deal, and it survives as
 * the audit trail regardless. Indexed by (source, sourceKey, externalId).
 *
 * Deliberately NOT contact-based: two separate purchases by the same person are
 * two orders, and person-level dedupe (which leads use) must never merge them.
 */
export async function findDealForExternalOrder(db, { source, sourceKey = null, externalId }) {
  if (!source || !externalId) return null;
  const prior = await db.ingressEvent.findFirst({
    where: {
      source,
      sourceKey: sourceKey ?? null,
      externalId: String(externalId),
      status: 'processed',
      dealId: { not: null },
    },
    orderBy: { processedAt: 'desc' },
    select: { id: true, dealId: true, normalized: true, processedAt: true },
  });
  if (!prior) return null;
  // The deal may have been deleted since; a dangling crosswalk must not
  // resurrect it or crash the update path.
  const deal = await db.deal.findUnique({ where: { id: prior.dealId }, select: { id: true, status: true } });
  if (!deal) return null;
  return { dealId: deal.id, dealStatus: deal.status, priorEventId: prior.id, priorNormalized: prior.normalized };
}

export async function findOpenDealForContact(db, contactId, since) {
  if (!contactId) return null;
  const link = await db.dealContact.findFirst({
    where: {
      contactId,
      deal: { status: 'open', ...(since ? { createdAt: { gte: since } } : {}) },
    },
    orderBy: { deal: { createdAt: 'desc' } },
    select: { dealId: true },
  });
  return link?.dealId || null;
}
