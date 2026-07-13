// Canonical mapping resolution: a TourEvent's template → the sellable Pricing
// Cards that have an ACTIVE WooProductMapping, each with its Woo product id and
// a representative ticket price. The mapping lives in GOS (WooProductMapping);
// nothing here hardcodes a Woo product id.

import { deriveTicketRows } from '../../pricing/groupTicketCards.js';
import { israelToday } from '../slotGeneration.js';

// A sellable card's FULL per-ticket-type price rows (each ticket type keeps its
// own canonical price — adult/child are distinct Woo variations, so there is NO
// "first ticket type" collapse). Returns [{ ticketTypeId, label, unitPriceMinor }]
// or [] when the card has no ticket-type pricing.
export async function cardTicketRows(client, cardGroupId) {
  const rep = await client.priceRule.findFirst({
    where: {
      cardGroupId,
      availableForGroupTickets: true,
      active: true,
      priceModel: 'ticket_types',
    },
    orderBy: { createdAt: 'asc' },
    include: { ticketPrices: { include: { ticketType: { select: { nameHe: true, sortOrder: true } } } } },
  });
  if (!rep) return [];
  return deriveTicketRows(rep) || [];
}

// The sellable cards for a template that are mapped to a Woo product. Returns
//   [{ cardGroupId, wooProductId, dateAttribute, config, ticketRows }]
// `config` is the per-product compatibility descriptor (global-taxonomy attribute
// identities + ticket→age-term map); `ticketRows` are the card's real per-age
// prices. Nothing here is product-specific — it all comes from the mapping row.
export async function resolveSellableCards(client, templateId) {
  if (!templateId) return [];
  const products = await client.openTourTemplateProduct.findMany({
    where: { templateId, cardGroupId: { not: null } },
    select: { cardGroupId: true },
  });
  const cardGroupIds = [...new Set(products.map((p) => p.cardGroupId).filter(Boolean))];
  if (!cardGroupIds.length) return [];
  const mappings = await client.wooProductMapping.findMany({
    where: { cardGroupId: { in: cardGroupIds }, active: true },
  });
  const out = [];
  for (const m of mappings) {
    out.push({
      cardGroupId: m.cardGroupId,
      wooProductId: m.wooProductId,
      dateAttribute: m.dateAttribute || null,
      config: m.config || null,
      ticketRows: await cardTicketRows(client, m.cardGroupId),
    });
  }
  return out;
}

// Re-sync every FUTURE sellable slot that offers a given card — used when the
// card's mapping (or price) changes, so existing variations refresh in place.
// Marks even already-synced tours pending (not just NULL).
export async function markCardSlotsPending(client, cardGroupId, { today = israelToday() } = {}) {
  const products = await client.openTourTemplateProduct.findMany({
    where: { cardGroupId },
    select: { templateId: true },
  });
  const templateIds = [...new Set(products.map((p) => p.templateId))];
  if (!templateIds.length) return 0;
  const res = await client.tourEvent.updateMany({
    where: {
      openTourTemplateId: { in: templateIds },
      kind: 'group_slot',
      status: 'scheduled',
      date: { gte: today },
    },
    data: { wooSyncStatus: 'pending', wooAttempts: 0, wooNextRetryAt: null },
  });
  return res.count;
}

// Template ids that have at least one mapped sellable card — used by the backfill
// sweep to mark only genuinely Woo-sellable slots pending.
export async function mappedTemplateIds(client) {
  const mappings = await client.wooProductMapping.findMany({
    where: { active: true },
    select: { cardGroupId: true },
  });
  const cardGroupIds = [...new Set(mappings.map((m) => m.cardGroupId))];
  if (!cardGroupIds.length) return [];
  const products = await client.openTourTemplateProduct.findMany({
    where: { cardGroupId: { in: cardGroupIds } },
    select: { templateId: true },
  });
  return [...new Set(products.map((p) => p.templateId))];
}
