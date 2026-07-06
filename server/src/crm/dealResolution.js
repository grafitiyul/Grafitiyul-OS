import { prisma } from '../db.js';

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
export async function dealsForContact(contactId) {
  const rows = await prisma.deal.findMany({
    where: { contacts: { some: { contactId } } },
    select: {
      id: true,
      title: true,
      status: true,
      tourDate: true,
      valueMinor: true,
      dealStageId: true,
      organizationId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length === 0) return [];
  const stageIds = [...new Set(rows.map((d) => d.dealStageId).filter(Boolean))];
  const orgIds = [...new Set(rows.map((d) => d.organizationId).filter(Boolean))];
  const [stages, orgs] = await Promise.all([
    stageIds.length
      ? // DealStage has label/labelEn — NOT name (live-QA Prisma error).
        prisma.dealStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, label: true } })
      : [],
    orgIds.length
      ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.label]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((d) => ({
    ...d,
    stageName: stageName.get(d.dealStageId) ?? null,
    organizationName: orgName.get(d.organizationId) ?? null,
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
