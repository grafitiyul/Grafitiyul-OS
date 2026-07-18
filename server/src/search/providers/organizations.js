// Organization search provider.
//
// NOTE on "email domain": Organization has no email-domain column (audit
// finding). The closest canonical field is financeEmail, so a domain query
// like "acme.co.il" matches through it rather than through an invented field.
// No duplicate search truth is created for this.

import { lookupLegacy, legacyCardHit, CANDIDATE_CAP } from '../lookups.js';
import { scoreOf, bestReason } from '../ranking.js';
import { contains, startsWith, equals } from '../text.js';

const INCLUDE = {
  organizationType: { select: { label: true } },
  units: { select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } },
  _count: { select: { deals: true, contactLinks: true } },
};

const INT4_MAX = 2147483647;

function ci(q) {
  return { contains: q, mode: 'insensitive' };
}

function reasonsForOrg(o, q, legacyByOrg, orgNo) {
  const out = [];
  // Public numeric identifier ("מספר ארגון") — exact match only, like the
  // deal-number path in the deals provider.
  if (orgNo !== null && o.orgNo === orgNo) {
    out.push({ key: 'org_number_exact', text: `#${o.orgNo}` });
  }
  if (equals(o.name, q)) out.push({ key: 'name_exact', text: o.name });
  else if (startsWith(o.name, q)) out.push({ key: 'name_prefix', text: o.name });
  else if (contains(o.name, q)) out.push({ key: 'name_partial', text: o.name });

  if (equals(o.taxId, q)) out.push({ key: 'tax_id_exact', text: o.taxId });
  else if (contains(o.taxId, q)) out.push({ key: 'name_partial', text: o.taxId });

  for (const u of o.units || []) {
    if (contains(u.name, q)) out.push({ key: 'unit_name_partial', text: u.name });
  }
  if (equals(o.financeEmail, q)) out.push({ key: 'email_exact', text: o.financeEmail });
  else if (contains(o.financeEmail, q)) out.push({ key: 'email_partial', text: o.financeEmail });

  for (const phone of [o.financePhone]) {
    if (contains(String(phone || '').replace(/\D/g, ''), String(q).replace(/\D/g, '')) && /\d/.test(q)) {
      out.push({ key: 'phone_partial', text: phone });
    }
  }
  if (contains(o.notes, q)) out.push({ key: 'note_partial', text: o.notes });

  const card = legacyCardHit(legacyByOrg.get(o.id), q);
  if (card) out.push({ key: 'legacy_partial', text: `${card.label}: ${card.value}`.trim() });

  return out;
}

function toDto(o, reasons, q) {
  const matchedUnits = (o.units || []).filter((u) => contains(u.name, q));
  const units = (matchedUnits.length ? matchedUnits : o.units || []).slice(0, 3);
  return {
    type: 'organization',
    id: o.id,
    orgNo: o.orgNo,
    // Prefer the public number in the URL (deals pattern); cuid fallback for
    // rows not yet backfilled — the server resolves both forms.
    path: `/admin/crm/organizations/${o.orgNo ?? o.id}`,
    name: o.name,
    typeLabel: o.organizationType?.label || null,
    units: units.map((u) => u.name),
    unitCount: (o.units || []).length,
    dealCount: o._count?.deals ?? 0,
    contactCount: o._count?.contactLinks ?? 0,
    reasons,
  };
}

export async function searchOrganizations(q, pq, limit, todayIso, db) {
  const trimmed = q.trim();
  const orgNo =
    /^\d+$/.test(trimmed) && Number(trimmed) <= INT4_MAX ? Number(trimmed) : null;

  const legacyRows = await lookupLegacy(q, 'Organization', db);
  const legacyByOrg = new Map(legacyRows.map((r) => [r.entityId, r.cardData]));

  const or = [
    { name: ci(q) },
    { taxId: ci(q) },
    { notes: ci(q) },
    { address: ci(q) },
    { financeEmail: ci(q) },
    { financeContactName: ci(q) },
    { units: { some: { name: ci(q) } } },
  ];
  if (orgNo !== null) or.push({ orgNo });
  if (/\d/.test(q)) or.push({ financePhone: { contains: q.replace(/\D/g, '') } });
  if (legacyByOrg.size) or.push({ id: { in: [...legacyByOrg.keys()] } });

  const rows = await db.organization.findMany({
    where: { OR: or },
    include: INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: CANDIDATE_CAP,
  });

  const hits = [];
  for (const o of rows) {
    const reasons = reasonsForOrg(o, q, legacyByOrg, orgNo);
    if (!reasons.length) continue;
    hits.push({
      score: scoreOf(reasons),
      groupRank: 0,
      updatedAt: o.updatedAt?.getTime?.() ?? 0,
      best: bestReason(reasons),
      dto: () => toDto(o, reasons, q),
    });
  }
  return { hits, truncated: rows.length >= CANDIDATE_CAP };
}
