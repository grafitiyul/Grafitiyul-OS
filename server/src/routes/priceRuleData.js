// PriceRule write-payload construction — pure, no Prisma/IO. Extracted from
// the route so the card-authoring invariants are unit-tested:
//
//   * VAT is EXPLICIT on every card rule. Creating a rule without a valid
//     vatMode is a validation error — never a silent null that would fall back
//     to the price list's default at resolution time. (The PriceList
//     defaultVatMode/Rate remains the VAT source for BUILDER LINES set to
//     'inherit' — that is its only live role.)
//   * `priority` is NOT writable. Every rule is created at priority 0 and card
//     resolution depends only on scope specificity, with a hard
//     ambiguous_price_rule error on genuine ties — no hidden per-rule knob can
//     silently change which card wins. (The engine still reads the column as a
//     deterministic tiebreak; production is all-zero.)
//   * firstLineNote blank markup normalizes to null (cardNotes contract).

import { normalizeFirstLineNote } from '../pricing/cardNotes.js';

export const PRICE_MODELS = ['per_head', 'tiered', 'tiered_group', 'fixed', 'ticket_types'];
// Card-level VAT. 'exempt' (פטור) is valid — the engine's splitVat handles it
// (net=gross, vat=0). Matches ADDON_VAT_MODES.
export const VAT_MODES = ['included', 'excluded', 'exempt'];

export class PriceRulePayloadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Minor-unit → BigInt | null. Accepts numbers/strings; '' and null → null.
export function toBig(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n));
}
export function toInt(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Build the writable data payload shared by create/update. `partial` controls
// whether absent keys are skipped (update) or defaulted (create). Throws
// PriceRulePayloadError on invalid payloads.
export function buildData(body, { partial }) {
  const data = {};
  const set = (key, val) => {
    if (partial && body[key] === undefined) return;
    data[key] = val;
  };
  // Scopes — empty/absent means wildcard (null).
  set('productId', body.productId || null);
  set('productVariantId', body.productVariantId || null);
  set('activityTypeId', body.activityTypeId || null);
  set('organizationSubtypeId', body.organizationSubtypeId || null);
  // Authoring tags (engine ignores these).
  set('pricingSegmentId', body.pricingSegmentId || null);
  set('cardGroupId', body.cardGroupId || null);
  // Price model fields.
  if (!partial || body.priceModel !== undefined)
    data.priceModel = PRICE_MODELS.includes(body.priceModel)
      ? body.priceModel
      : 'per_head';
  set('adultPriceMinor', toBig(body.adultPriceMinor));
  set('childPriceMinor', toBig(body.childPriceMinor));
  set('basePriceMinor', toBig(body.basePriceMinor));
  set('baseParticipants', toInt(body.baseParticipants));
  set('perAdditionalParticipantMinor', toBig(body.perAdditionalParticipantMinor));
  set('fixedPriceMinor', toBig(body.fixedPriceMinor));
  // VAT — explicit, always (invariant above). Create requires a valid mode;
  // update accepts a valid mode or leaves VAT untouched.
  if (body.vatMode !== undefined || !partial) {
    if (!VAT_MODES.includes(body.vatMode))
      throw new PriceRulePayloadError(partial ? 'vat_mode_invalid' : 'vat_mode_required');
    data.vatMode = body.vatMode;
  }
  set('vatRate', toInt(body.vatRate));
  // Card-level business capability — "Available for Group Ticket Sales". The card
  // is the sole authority for the Group Ticket Builder. Duplicated across siblings.
  set('availableForGroupTickets', body.availableForGroupTickets === true);
  // First-line note template (rich text) the calculation writes onto the first
  // builder line this card produces. Blank markup normalizes to null (= no note).
  // Duplicated across siblings like availableForGroupTickets.
  set('firstLineNote', normalizeFirstLineNote(body.firstLineNote));
  // Card display order (business). Engine ignores it.
  set('cardSortOrder', toInt(body.cardSortOrder) ?? 0);
  if (!partial || body.active !== undefined) data.active = body.active !== false;
  return data;
}

// Normalize an incoming tiers array into PriceTier create rows. Skips malformed
// rows (missing/negative bound). Order is preserved via sortOrder so the engine
// reads the ladder deterministically even if uptoParticipants ties.
export function buildTierRows(tiers) {
  if (!Array.isArray(tiers)) return null; // null = "caller didn't send tiers"
  return tiers
    .map((t, i) => ({
      uptoParticipants: toInt(t?.uptoParticipants),
      totalPriceMinor: toBig(t?.totalPriceMinor),
      sortOrder: toInt(t?.sortOrder) ?? i,
    }))
    .filter(
      (t) => t.uptoParticipants != null && t.uptoParticipants >= 0 && t.totalPriceMinor != null,
    );
}

// Ticket-price rows for the ticket_types model. null = caller didn't send any.
// Drops rows missing a ticketTypeId or price; de-dupes by ticketTypeId (last wins)
// to satisfy the @@unique(priceRuleId, ticketTypeId) constraint.
export function buildTicketRows(ticketPrices) {
  if (!Array.isArray(ticketPrices)) return null;
  const byType = new Map();
  for (const p of ticketPrices) {
    const ticketTypeId = p?.ticketTypeId ? String(p.ticketTypeId) : null;
    const priceMinor = toBig(p?.priceMinor);
    if (!ticketTypeId || priceMinor == null) continue;
    byType.set(ticketTypeId, { ticketTypeId, priceMinor });
  }
  return [...byType.values()];
}

const ADDON_VAT_MODES = ['included', 'excluded', 'exempt'];
// 'sabbath_holiday' defers to the שעות שבת וחג module; 'weekdays' uses the per-card
// weekday set; 'manual' is owner-toggled. Anything else falls back to 'manual'.
const ADDON_AUTO_APPLY = ['manual', 'weekdays', 'sabbath_holiday'];

// Card add-on rows. null = caller didn't send any. De-dupes by addonId; clamps
// weekdays to 0..6; vatMode null = inherit the card's VAT.
export function buildAddonRows(addons) {
  if (!Array.isArray(addons)) return null;
  const seen = new Set();
  const rows = [];
  addons.forEach((a, i) => {
    const addonId = a?.addonId ? String(a.addonId) : null;
    if (!addonId || seen.has(addonId)) return;
    seen.add(addonId);
    const weekdays = Array.isArray(a?.autoApplyWeekdays)
      ? [...new Set(a.autoApplyWeekdays.map((n) => Math.max(0, Math.min(6, Math.floor(Number(n)) || 0))))]
      : [];
    rows.push({
      addonId,
      enabled: a?.enabled !== false,
      // null = inherit (system add-on inherits the catalog default price).
      priceMinor: toBig(a?.priceMinor),
      vatMode: ADDON_VAT_MODES.includes(a?.vatMode) ? a.vatMode : null,
      vatRate: toInt(a?.vatRate),
      autoApply: ADDON_AUTO_APPLY.includes(a?.autoApply) ? a.autoApply : 'manual',
      // weekdays only meaningful for the 'weekdays' mode; clear otherwise.
      autoApplyWeekdays: a?.autoApply === 'weekdays' ? weekdays : [],
      sortOrder: toInt(a?.sortOrder) ?? i,
    });
  });
  return rows;
}
