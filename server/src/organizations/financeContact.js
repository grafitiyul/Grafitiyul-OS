// The ONE write path for an Organization's finance contact.
//
// Canonical model: Organization.financeContactId points at a REAL Contact
// (exactly one current finance contact per organization). The legacy
// financeContactName/financePhone/financeEmail scalars are a display MIRROR
// owned by this service — they are rewritten here on every change and must
// never be edited independently (org routes + the agent form both call in).
//
// Replacing the designation NEVER edits or deletes the previous Contact: the
// person keeps their Contact row and organization membership; only the
// "current finance contact" designation moves, and the transfer is recorded
// on the organization timeline (previous → new, source, actor context).
//
// Identity matching (canonical rules, in priority order):
//   1. normalized phone match (whatsapp/phone.js normalizePhoneIntl — the
//      GOS-wide phone identity rule; the ORIGINAL entered value is stored)
//   2. email match (case-insensitive) when no phone match exists
//   3. otherwise a NEW Contact is created
// Names are NEVER used for matching — two people sharing a name are two
// contacts.
//
// Concurrency: every call takes a per-organization Postgres advisory
// transaction lock, so two concurrent submissions cannot create duplicate
// contacts for the same nomination or leave conflicting designations.

import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { normalizePhoneIntl } from '../whatsapp/phone.js';

export const FINANCE_ORG_ROLE = 'איש כספים';

const SOURCE_LABELS = {
  travel_agent: 'טופס הזמנות סוכנים',
  admin: 'עריכת ארגון',
  migration: 'הסבת נתונים',
};

function coded(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// Serialize finance-contact work per organization. xact-scoped: released
// automatically on commit/rollback. No-op for injected test fakes.
async function lockOrganization(tx, organizationId) {
  if (typeof tx.$queryRaw !== 'function') return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`;
}

// Match an existing Contact by the canonical identity rules, else create one.
export async function resolveFinanceContact(tx, { name, email, phone }) {
  const wanted = normalizePhoneIntl(phone);
  if (wanted) {
    // Candidates narrowed by the last 7 digits, then canonical equality.
    const candidates = await tx.contactPhone.findMany({
      where: { value: { contains: wanted.slice(-7) } },
      select: { contactId: true, value: true },
      take: 50,
    });
    const hit = candidates.find((c) => normalizePhoneIntl(c.value) === wanted);
    if (hit) return { contactId: hit.contactId, matchedBy: 'phone' };
  }
  if (email) {
    const hit = await tx.contactEmail.findFirst({
      where: { value: { equals: email, mode: 'insensitive' } },
      select: { contactId: true },
    });
    if (hit) return { contactId: hit.contactId, matchedBy: 'email' };
  }
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  const contact = await tx.contact.create({
    data: {
      firstNameHe: tokens[0] || String(name || '').trim(),
      lastNameHe: tokens.slice(1).join(' '),
      firstNameEn: '',
      lastNameEn: '',
      ...(phone ? { phones: { create: { value: phone, isPrimary: true } } } : {}),
      ...(email ? { emails: { create: { value: email, isPrimary: true } } } : {}),
    },
    select: { id: true },
  });
  return { contactId: contact.id, matchedBy: 'created' };
}

// Ensure the contact is a member of the organization (canonical
// ContactOrganization link). Existing memberships are left untouched.
async function ensureOrgMembership(tx, contactId, organizationId) {
  const existing = await tx.contactOrganization.findFirst({
    where: { contactId, organizationId },
    select: { id: true },
  });
  if (existing) return;
  await tx.contactOrganization.create({
    data: { contactId, organizationId, role: FINANCE_ORG_ROLE },
  });
}

function contactDisplayName(c) {
  if (!c) return null;
  return (
    `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() ||
    `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() ||
    null
  );
}

/**
 * Set (or clear) the organization's CURRENT finance contact.
 *
 * @param tx      prisma transaction client
 * @param opts    { organizationId, name, email, phone, source, context, origin }
 *                Empty name+email+phone clears the designation.
 * @returns { changed, cleared?, contactId?, matchedBy?, previousContactId? }
 */
export async function setOrganizationFinanceContact(
  tx,
  { organizationId, name = null, email = null, phone = null, source = 'admin', context = {}, origin } = {},
) {
  await lockOrganization(tx, organizationId);
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      financeContactId: true,
      financeContactName: true,
      financeEmail: true,
      financePhone: true,
      financeContact: {
        select: { id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
      },
    },
  });
  if (!org) throw coded('organization_not_found');

  const sourceLabel = SOURCE_LABELS[source] || source;
  const eventOrigin = origin || systemOrigin();

  // Clear mode — designation removed; the Contact itself is untouched.
  if (!name && !email && !phone) {
    if (!org.financeContactId && !org.financeEmail && !org.financeContactName && !org.financePhone) {
      return { changed: false };
    }
    await tx.organization.update({
      where: { id: organizationId },
      data: { financeContactId: null, financeContactName: null, financeEmail: null, financePhone: null },
    });
    await emitTimelineEvent(tx, {
      subjectType: 'organization',
      subjectId: organizationId,
      kind: 'note',
      body: `<p>הגדרת איש הכספים הוסרה (${sourceLabel}).</p>`,
      data: { event: 'finance_contact_cleared', previousContactId: org.financeContactId, source, ...context },
      origin: eventOrigin,
    });
    return { changed: true, cleared: true, previousContactId: org.financeContactId };
  }

  const { contactId, matchedBy } = await resolveFinanceContact(tx, { name, email, phone });
  await ensureOrgMembership(tx, contactId, organizationId);

  const changed = org.financeContactId !== contactId;
  // The mirror always reflects the CURRENT nomination as displayed.
  await tx.organization.update({
    where: { id: organizationId },
    data: {
      financeContactId: contactId,
      financeContactName: name || null,
      financeEmail: email || null,
      financePhone: phone || null,
    },
  });

  if (changed) {
    const prevName = contactDisplayName(org.financeContact) || org.financeContactName;
    await emitTimelineEvent(tx, {
      subjectType: 'organization',
      subjectId: organizationId,
      kind: 'note',
      body: `<p>${org.financeContactId ? 'איש הכספים הוחלף' : 'הוגדר איש כספים'}: ${name || email}${
        prevName ? ` (במקום ${prevName})` : ''
      } — ${sourceLabel}.</p>`,
      data: {
        event: 'finance_contact_changed',
        previousContactId: org.financeContactId,
        newContactId: contactId,
        matchedBy,
        source,
        ...context,
      },
      origin: eventOrigin,
    });
  }

  return { changed, contactId, matchedBy, previousContactId: org.financeContactId };
}

// Read helper: the finance contact as DISPLAYED (canonical Contact first,
// service-owned mirror as fallback for not-yet-migrated rows).
export function financeContactDisplay(org) {
  if (!org) return null;
  const contact = org.financeContact || null;
  const name = contactDisplayName(contact) || org.financeContactName || null;
  const email = contact?.emails?.[0]?.value || org.financeEmail || null;
  const phone = contact?.phones?.[0]?.value || org.financePhone || null;
  if (!name && !email && !phone) return null;
  return { contactId: org.financeContactId || null, name, email, phone };
}
