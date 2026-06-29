// Pure transform: PriceRule rows → the Group Ticket Builder card list. No Prisma /
// IO, so the business rules below are unit-tested in isolation.
//
// Rules enforced here:
//   * A card is SELLABLE only with explicit ticket-type pricing (priceModel
//     'ticket_types' + at least one priced ticket type). NO fabricated/fallback
//     rows for per_head / fixed / tiered / empty cards.
//   * Each sellable row carries its ticketTypeId so the saved line gets a
//     STRUCTURED identity (cardGroupId + ticketTypeId), never note-encoded.
//   * Flagged-but-unconfigured cards are returned separately so the UI can warn —
//     business configuration must be explicit, never guessed.

function num(v) {
  return v == null ? null : Number(v);
}

// A card's sellable ticket rows — STRICTLY from its priced ticket types. Returns
// null when the card has no ticket-type pricing (caller marks it unconfigured).
export function deriveTicketRows(rep) {
  if (rep.priceModel !== 'ticket_types') return null;
  const tickets = (rep.ticketPrices || [])
    .filter((p) => p.ticketTypeId)
    .sort((a, b) => (a.ticketType?.sortOrder ?? 0) - (b.ticketType?.sortOrder ?? 0));
  if (!tickets.length) return null;
  return tickets.map((p) => ({
    key: `tt:${p.ticketTypeId}`,
    ticketTypeId: p.ticketTypeId,
    label: p.ticketType?.nameHe || 'כרטיס',
    unitPriceMinor: num(p.priceMinor) ?? 0,
  }));
}

// Dedupe sibling PriceRules → one card per cardGroupId (input order preserved), and
// split into sellable `cards` vs `unconfigured`. The flag is the SOLE authority for
// WHICH rules arrive here; this function never filters by product/city/activity.
export function buildGroupCards(rules) {
  const seen = new Set();
  const cards = [];
  const unconfigured = [];
  for (const rep of rules || []) {
    if (!rep.cardGroupId || seen.has(rep.cardGroupId)) continue;
    seen.add(rep.cardGroupId);
    // Display only — NOT a filter.
    const title = rep.product?.nameHe || 'כרטיס תמחור';
    const rows = deriveTicketRows(rep);
    if (!rows) {
      unconfigured.push({ cardGroupId: rep.cardGroupId, title });
      continue;
    }
    cards.push({
      cardGroupId: rep.cardGroupId,
      title,
      // The product this card prices — used by the Group Ticket Builder to keep the
      // Deal product as a single source of truth (Deal product = first selected
      // card's product). Display still uses `title`; ids are never shown.
      productId: rep.productId || null,
      productVariantId: rep.productVariantId || null,
      priceModel: rep.priceModel,
      // Card VAT, so each ticket line inherits the card's VAT explicitly.
      vatMode: rep.vatMode || null,
      vatRate: rep.vatRate ?? null,
      rows,
    });
  }
  return { cards, unconfigured };
}
