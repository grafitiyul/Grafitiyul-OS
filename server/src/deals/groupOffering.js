import { deriveOperational } from '../tours/operationalProduct.js';

// Resolve a group Deal's CANONICAL purchased offering from the Group Ticket
// Builder's quote lines (the source of truth for what the customer bought) — NOT
// from any TourEvent variant snapshot. Returns:
//   { productVariantId, productId, quantity, ticketBreakdown }
// where productVariantId is the operationally-DOMINANT card variant (the superset
// among the cards bought — so a plain-only deal is plain, a deal with any
// workshop card is workshop), and ticketBreakdown is the full composition for
// the per-customer / aggregate breakdown UI. Returns null when the deal has no
// group-ticket lines (caller falls back to deal.productVariantId).
export async function resolveDealGroupOffering(client, dealId) {
  // No quote subsystem reachable (or no working version) → no group offering; the
  // caller falls back to deal.productVariantId. Keeps single-product deal paths
  // (and their fakes) working without a quote surface.
  if (!dealId || !client?.quoteVersion?.findFirst) return null;
  const version = await client.quoteVersion.findFirst({ where: { dealId, isWorking: true }, select: { id: true } });
  if (!version) return null;
  const lines = await client.quoteLine.findMany({
    where: { quoteVersionId: version.id, sourceKind: 'group_ticket', active: true, quantity: { gt: 0 } },
    select: {
      sourceCardGroupId: true,
      productVariantId: true,
      quantity: true,
      ticketTypeId: true,
      ticketType: { select: { nameHe: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });
  if (!lines.length) return null;

  const cardIds = [...new Set(lines.map((l) => l.sourceCardGroupId).filter(Boolean))];
  const rules = cardIds.length
    ? await client.priceRule.findMany({
        where: { cardGroupId: { in: cardIds } },
        select: { cardGroupId: true, product: { select: { nameHe: true } } },
      })
    : [];
  const titleByCard = new Map();
  for (const r of rules) if (r.cardGroupId && !titleByCard.has(r.cardGroupId)) titleByCard.set(r.cardGroupId, r.product?.nameHe || 'כרטיס');

  const ticketBreakdown = lines.map((l) => ({
    cardGroupId: l.sourceCardGroupId || null,
    cardTitle: titleByCard.get(l.sourceCardGroupId) || 'כרטיס',
    ticketTypeId: l.ticketTypeId || null,
    ticketLabel: l.ticketType?.nameHe || 'כרטיס',
    productVariantId: l.productVariantId || null,
    quantity: l.quantity || 0,
  }));
  const quantity = ticketBreakdown.reduce((n, b) => n + (b.quantity || 0), 0);

  // Dominant operational variant across the DISTINCT card variants bought.
  const variantIds = [...new Set(ticketBreakdown.map((b) => b.productVariantId).filter(Boolean))];
  let productVariantId = null;
  let productId = null;
  if (variantIds.length) {
    const variants = await client.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        productId: true,
        durationHours: true,
        activityComponents: { orderBy: { sortOrder: 'asc' }, select: { activityComponentId: true } },
      },
    });
    const derived = deriveOperational(variants);
    if (derived) {
      productVariantId = derived.displayVariantId;
      productId = derived.displayProductId;
    }
  }
  return { productVariantId, productId, quantity, ticketBreakdown };
}

// Participant aggregation moved to tours/participants.js (groupBreakdownByProduct
// + tourParticipantBreakdown) — the ONE canonical breakdown builder shared by the
// admin tour modal and the Guide Portal.
