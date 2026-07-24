// Travel Agency Reservations — the canonical "reservation group → OPEN Deal"
// creation service (Slice 3). Called ONLY inside the processor's per-group
// transaction; never from routes directly.
//
// Binding decisions enforced here:
//   #1 stage "הסכמה לסגירה" (DealStage.key stage_a88c9186), status=open, NO
//      TourEvent/registration/seat hold — operational commitment stays in the
//      existing WON flow.
//   #2 the agent Contact is the primary DealContact; the agency Organization
//      is the Deal organization; activityType comes from the canonical
//      classification rule (org-linked ⇒ business), never set ad hoc.
//   #5 a filled on-site contact becomes a Contact linked with role 'fieldRep'
//      ("נציג בשטח") — the existing role the guide portal already displays.
//   #6 groupName seeds BOTH the Deal title and the dedicated Deal.groupName.
//
// Every failure is a coded error (e.code) so the processor can store a stable
// machine-readable reason and the admin surface can explain it.

import { normalizeClassification } from '../deals/classification.js';

export const INTAKE_STAGE_KEY = 'stage_a88c9186'; // "הסכמה לסגירה" (canonical key)
const SOURCE_LABEL = 'טופס סוכנים';

function coded(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// DealSource has no stable key column (label-only catalog) — find-or-create by
// the exact label. The label is a constant owned by this module, so the lookup
// is deterministic even though it is label-based.
async function travelAgentSourceId(tx) {
  const existing = await tx.dealSource.findFirst({ where: { label: SOURCE_LABEL } });
  if (existing) return existing.id;
  const created = await tx.dealSource.create({ data: { label: SOURCE_LABEL } });
  return created.id;
}

const digits = (s) => String(s || '').replace(/\D/g, '');

// Canonical comparable form: digits, Israel country code and leading zero
// stripped — so '050-1234567', '+972501234567' and '0501234567' all agree.
function canonPhone(s) {
  let d = digits(s);
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

// On-site representative → Contact. Reuse an existing contact when a phone
// matches (canonical-digit equality) so repeat bookings with the same rep
// don't multiply contacts; otherwise create a minimal contact with the phone
// as primary. Split heuristics: first token = first name, rest = last name.
export async function resolveFieldRepContact(tx, { onSiteContactName, onSiteContactPhone }) {
  const name = String(onSiteContactName || '').trim();
  const phone = String(onSiteContactPhone || '').trim();
  if (!name || !phone) return null;

  const wanted = canonPhone(phone);
  if (wanted.length >= 8) {
    // Candidate rows narrowed by the last 7 digits, then canonical equality.
    const candidates = await tx.contactPhone.findMany({
      where: { value: { contains: wanted.slice(-7) } },
      select: { contactId: true, value: true },
      take: 50,
    });
    const hit = candidates.find((c) => canonPhone(c.value) === wanted);
    if (hit) return hit.contactId;
  }

  const tokens = name.split(/\s+/);
  const contact = await tx.contact.create({
    data: {
      firstNameHe: tokens[0] || name,
      lastNameHe: tokens.slice(1).join(' '),
      firstNameEn: '',
      lastNameEn: '',
      phones: { create: { value: phone, isPrimary: true } },
    },
    select: { id: true },
  });
  return contact.id;
}

export async function createDealFromReservationGroup(tx, { session, group }) {
  // The agent contact / agency org are denormalized on the session with
  // SetNull FKs — a deleted contact/org makes the group fail loudly rather
  // than creating an orphaned deal (admin resolves, then reprocesses).
  if (!session.contactId) throw coded('agent_contact_missing');
  if (!session.organizationId) throw coded('organization_missing');

  const stage = await tx.dealStage.findUnique({
    where: { key: INTAKE_STAGE_KEY },
    select: { id: true },
  });
  if (!stage) throw coded('stage_not_found');

  const variant = group.productVariantId
    ? await tx.productVariant.findUnique({
        where: { id: group.productVariantId },
        select: { id: true, productId: true, locationId: true },
      })
    : null;
  if (!variant) throw coded('catalog_missing');

  const org = await tx.organization.findUnique({
    where: { id: session.organizationId },
    select: { id: true, organizationTypeId: true },
  });
  if (!org) throw coded('organization_missing');

  // Canonical classification rule — org-linked forces business + clears the
  // deal-level type copy. Same call shape as the deals route.
  const classification = normalizeClassification({
    organizationId: org.id,
    activityType: 'business',
    organizationTypeId: null,
    organizationSubtypeId: null,
    orgTypeId: org.organizationTypeId,
    subtypeTypeId: null,
  });

  // Deal contacts — merged by contactId (a person may hold several roles).
  const rolesByContact = new Map([[session.contactId, { isPrimary: true, roles: ['ongoingBooking'] }]]);
  const addRole = (contactId, role) => {
    if (!contactId) return;
    const cur = rolesByContact.get(contactId);
    if (cur) {
      if (!cur.roles.includes(role)) cur.roles.push(role);
    } else {
      rolesByContact.set(contactId, { isPrimary: false, roles: [role] });
    }
  };
  const fieldRepId = await resolveFieldRepContact(tx, group);
  if (fieldRepId) addRole(fieldRepId, 'fieldRep');
  // Invoice-to-finance reservations link the organization's resolved finance
  // Contact (frozen on the session snapshot) with the canonical 'finance'
  // role, so Deal + accounting flows show the same person.
  const inv = session.payloadSnapshot?.invoice;
  if (inv?.toFinance && inv.financeContactId) {
    const financeContact = await tx.contact.findUnique({
      where: { id: inv.financeContactId },
      select: { id: true },
    });
    if (financeContact) addRole(financeContact.id, 'finance');
  }
  const contactsCreate = [...rolesByContact.entries()].map(([contactId, v]) => ({
    contactId,
    isPrimary: v.isPrimary,
    roles: v.roles,
  }));

  return tx.deal.create({
    data: {
      title: group.groupName,
      groupName: group.groupName,
      dealStageId: stage.id,
      status: 'open',
      ...classification,
      organizationId: org.id,
      productId: variant.productId,
      productVariantId: variant.id,
      locationId: variant.locationId,
      tourDate: group.tourDate,
      tourTime: group.tourTime,
      participants: group.participants,
      // Canonical group-count contract: guides on the reservation card ARE the
      // Deal's operational group count (NULL = 1).
      groups: group.groups || null,
      tourLanguage: group.tourLanguage,
      communicationLanguage: session.language,
      dealSourceId: await travelAgentSourceId(tx),
      source: `${SOURCE_LABEL} — בקשה #${session.sessionNo}`,
      notes: group.notes,
      contacts: { create: contactsCreate },
    },
    select: { id: true, orderNo: true },
  });
}
