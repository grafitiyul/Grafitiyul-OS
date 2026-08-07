import { prisma } from '../db.js';
import { activeDealWhere } from '../deals/mergeLineage.js';

// Shared "which Deal does this conversation belong to?" logic — ONE source of
// truth used by both the WhatsApp inbox and the Email inbox. Deterministic when
// confident, asks when not (product spec):
//   exactly ONE candidate          → open       (candidates = open deals +
//                                                WON deals toured ≤7 days ago)
//   several candidates             → choose
//   contact with no deals at all   → no_deals
//   only stale LOST/old-WON deals  → old_or_new

export function dealSummary(d) {
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    tourDate: d.tourDate,
    organizationName: d.organizationName ?? null,
    valueMinor: d.valueMinor,
    stageName: d.stageName ?? null,
  };
}

// The deals a contact is linked to, enriched with stage/org names. Written
// WITHOUT nested relation includes on purpose — the production Prisma client
// rejected `include.deal.include.dealStage` ("Unknown argument dealStage")
// even though the same query validates locally; plain scalar selects + two
// id-lookups are immune to that class of failure.
// `db` is injectable for tests; existing callers (whatsapp.js) omit it.
// Exported for the Prisma-shape contract test (fake-db suites cannot catch a
// field that doesn't exist on the real model — the DMMF walk can).
export const CONTACT_DEALS_SELECT = {
  id: true,
  orderNo: true,
  title: true,
  status: true,
  activityType: true,
  tourDate: true,
  valueMinor: true,
  currency: true,
  dealStageId: true,
  organizationId: true,
  productId: true,
  createdAt: true,
  lastMeaningfulActivityAt: true,
};

export async function dealsForContact(contactId, db = prisma) {
  const rows = await db.deal.findMany({
    // A deal retired by a merge is never a candidate for "which deal does this
    // conversation belong to" — the survivor now represents that transaction,
    // and stamping the retired one would file the message where nobody looks.
    where: activeDealWhere({ contacts: { some: { contactId } } }),
    select: CONTACT_DEALS_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length === 0) return [];
  const stageIds = [...new Set(rows.map((d) => d.dealStageId).filter(Boolean))];
  const orgIds = [...new Set(rows.map((d) => d.organizationId).filter(Boolean))];
  const productIds = [...new Set(rows.map((d) => d.productId).filter(Boolean))];
  const [stages, orgs, products] = await Promise.all([
    stageIds.length
      ? // DealStage has label/labelEn — NOT name (live-QA Prisma error).
        db.dealStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, label: true } })
      : [],
    orgIds.length
      ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [],
    productIds.length
      ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, nameHe: true } })
      : [],
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.label]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const productName = new Map(products.map((p) => [p.id, p.nameHe]));
  return rows.map((d) => ({
    ...d,
    stageName: stageName.get(d.dealStageId) ?? null,
    organizationName: orgName.get(d.organizationId) ?? null,
    productName: productName.get(d.productId) ?? null,
  }));
}

// The Contact page's "דילים קודמים" panel DTO: canonical CRM ordering (latest
// MEANINGFUL activity first, createdAt as the pre-backfill fallback — the same
// rule as the Deals list default sort) + an explicit field whitelist so the
// panel payload never grows internal fields by accident. Pure — sorts a copy.
export function contactDealsPanel(deals) {
  const ts = (d) => new Date(d.lastMeaningfulActivityAt ?? d.createdAt).getTime() || 0;
  return [...deals]
    .sort((a, b) => ts(b) - ts(a))
    .map((d) => ({
      id: d.id,
      orderNo: d.orderNo,
      title: d.title,
      status: d.status,
      activityType: d.activityType ?? null,
      tourDate: d.tourDate ?? null,
      valueMinor: d.valueMinor,
      currency: d.currency ?? 'ILS',
      stageName: d.stageName ?? null,
      organizationName: d.organizationName ?? null,
      productName: d.productName ?? null,
      createdAt: d.createdAt,
      lastMeaningfulActivityAt: d.lastMeaningfulActivityAt ?? null,
    }));
}

// Classify a contact's deals into the resolution outcome. Pure function —
// callers decorate with contactName etc.
export function classifyDealsForContact(deals) {
  if (!deals.length) return { kind: 'no_deals' };
  // tourDate is "YYYY-MM-DD" — lexicographic compare is date compare.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const open = deals.filter((d) => d.status === 'open');
  const recentWon = deals.filter((d) => d.status === 'won' && d.tourDate && d.tourDate >= sevenDaysAgo);
  const candidates = [...open, ...recentWon];
  if (candidates.length === 1) return { kind: 'open', dealId: candidates[0].id };
  if (candidates.length > 1) return { kind: 'choose', deals: candidates.map(dealSummary) };
  return { kind: 'old_or_new', deals: deals.map(dealSummary) };
}
