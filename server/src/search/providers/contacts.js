// Contact search provider.

import { lookupPhoneContacts, lookupEmailContacts, lookupLegacy, legacyCardHit, CANDIDATE_CAP } from '../lookups.js';
import { scoreOf, bestReason } from '../ranking.js';
import { contactNameOr } from '../nameWhere.js';
import { contains, startsWith, equals, fullNameHe, fullNameEn } from '../text.js';

const INCLUDE = {
  phones: { select: { value: true, isPrimary: true, label: true }, orderBy: { sortOrder: 'asc' } },
  emails: { select: { value: true, isPrimary: true }, orderBy: { sortOrder: 'asc' } },
  orgLinks: {
    select: {
      isPrimary: true,
      role: true,
      organization: { select: { id: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
    },
  },
  // Linked-deal context for the result row. Bounded to 3 — this is a preview,
  // not the contact page.
  dealContacts: {
    select: { deal: { select: { id: true, orderNo: true, title: true, status: true } } },
    orderBy: { deal: { updatedAt: 'desc' } },
    take: 3,
  },
  _count: { select: { dealContacts: true } },
};

const INT4_MAX = 2147483647;

function ci(q) {
  return { contains: q, mode: 'insensitive' };
}

function nameReasons(c, q) {
  const out = [];
  for (const name of [fullNameHe(c), fullNameEn(c)]) {
    if (!name) continue;
    if (equals(name, q)) out.push({ key: 'name_exact', text: name });
    else if (startsWith(name, q)) out.push({ key: 'name_prefix', text: name });
    else if (contains(name, q)) out.push({ key: 'name_partial', text: name });
  }
  if (out.length) return out;
  for (const part of [c.firstNameHe, c.lastNameHe, c.firstNameEn, c.lastNameEn]) {
    if (equals(part, q)) return [{ key: 'name_exact', text: fullNameHe(c) || fullNameEn(c) }];
    if (contains(part, q)) return [{ key: 'name_partial', text: fullNameHe(c) || fullNameEn(c) }];
  }
  return out;
}

function reasonsForContact(c, q, phoneMap, emailMap, legacyByContact, contactNo) {
  const out = [...nameReasons(c, q)];

  // Public numeric identifier ("מספר איש קשר") — exact match only, like the
  // deal-number path in the deals provider.
  if (contactNo !== null && c.contactNo === contactNo) {
    out.push({ key: 'contact_number_exact', text: `#${c.contactNo}` });
  }

  const phone = phoneMap.get(c.id);
  if (phone) out.push({ key: phone.exact ? 'phone_exact' : 'phone_partial', text: phone.value });
  const email = emailMap.get(c.id);
  if (email) out.push({ key: email.exact ? 'email_exact' : 'email_partial', text: email.value });

  if (equals(c.taxId, q)) out.push({ key: 'tax_id_exact', text: c.taxId });

  for (const link of c.orgLinks || []) {
    if (contains(link.organization?.name, q)) {
      out.push({ key: 'org_name_partial', text: link.organization.name });
    }
    if (contains(link.organizationUnit?.name, q)) {
      out.push({ key: 'unit_name_partial', text: link.organizationUnit.name });
    }
  }
  if (contains(c.notes, q)) out.push({ key: 'note_partial', text: c.notes });

  const card = legacyCardHit(legacyByContact.get(c.id), q);
  if (card) out.push({ key: 'legacy_partial', text: `${card.label}: ${card.value}`.trim() });

  return out;
}

function toDto(c, reasons) {
  const primaryPhone = (c.phones || []).find((p) => p.isPrimary) || (c.phones || [])[0] || null;
  const primaryEmail = (c.emails || []).find((e) => e.isPrimary) || (c.emails || [])[0] || null;
  const link = (c.orgLinks || []).find((l) => l.isPrimary) || (c.orgLinks || [])[0] || null;
  return {
    type: 'contact',
    id: c.id,
    contactNo: c.contactNo,
    // Prefer the public number in the URL (deals pattern); cuid fallback for
    // rows not yet backfilled — the server resolves both forms.
    path: `/admin/crm/contacts/${c.contactNo ?? c.id}`,
    fullNameHe: fullNameHe(c),
    fullNameEn: fullNameEn(c),
    phone: primaryPhone?.value || null,
    email: primaryEmail?.value || null,
    organizationName: link?.organization?.name || null,
    unitName: link?.organizationUnit?.name || null,
    dealCount: c._count?.dealContacts ?? 0,
    recentDeals: (c.dealContacts || [])
      .map((dc) => dc.deal)
      .filter(Boolean)
      .map((d) => ({ id: d.id, orderNo: d.orderNo, title: d.title, status: d.status })),
    reasons,
  };
}

export async function searchContacts(q, pq, limit, todayIso, db) {
  const trimmed = q.trim();
  const contactNo =
    /^\d+$/.test(trimmed) && Number(trimmed) <= INT4_MAX ? Number(trimmed) : null;

  const [phoneMap, emailMap, legacyRows] = await Promise.all([
    lookupPhoneContacts(pq, db),
    lookupEmailContacts(q, db),
    lookupLegacy(q, 'Contact', db),
  ]);
  const legacyByContact = new Map(legacyRows.map((r) => [r.entityId, r.cardData]));

  const or = [
    ...contactNameOr(q),
    { notes: ci(q) },
    { taxId: ci(q) },
    { orgLinks: { some: { organization: { is: { name: ci(q) } } } } },
    { orgLinks: { some: { organizationUnit: { is: { name: ci(q) } } } } },
  ];
  if (contactNo !== null) or.push({ contactNo });
  const contactIds = [...new Set([...phoneMap.keys(), ...emailMap.keys(), ...legacyByContact.keys()])];
  if (contactIds.length) or.push({ id: { in: contactIds } });

  const rows = await db.contact.findMany({
    where: { OR: or },
    include: INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: CANDIDATE_CAP,
  });

  const hits = [];
  for (const c of rows) {
    const reasons = reasonsForContact(c, q, phoneMap, emailMap, legacyByContact, contactNo);
    if (!reasons.length) continue;
    hits.push({
      score: scoreOf(reasons),
      groupRank: 0,
      updatedAt: c.updatedAt?.getTime?.() ?? 0,
      best: bestReason(reasons),
      dto: () => toDto(c, reasons),
    });
  }
  return { hits, truncated: rows.length >= CANDIDATE_CAP };
}
