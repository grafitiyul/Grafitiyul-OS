// Pure WooCommerce desired-state derivation: a TourEvent + its sellable card +
// canonical capacity → the WooCommerce Variation payload. No IO, so the mirror
// rules are unit-tested in isolation. WooCommerce simply REFLECTS canonical GOS
// state — there is no business logic here beyond formatting.

// Metadata keys that give every generated variation a stable link back to GOS
// (idempotent updates, webhook matching in the next slice, debugging).
export const META_TOUREVENT_ID = '_gos_tourevent_id';
export const META_CARD_GROUP_ID = '_gos_card_group_id';
export const META_CAPACITY = '_gos_capacity';
export const META_DATE = '_gos_date';
export const META_START_TIME = '_gos_start_time';
// Per-variant identity: ONE occurrence yields many variations (age × activity),
// so these pin which ticket type (age) a given variation prices.
export const META_TICKET_TYPE_ID = '_gos_ticket_type_id';
export const META_VARIANT_KEY = '_gos_variant_key';

// "08.08.2026 10:00" — the occurrence label used as the date-attribute option.
export function occurrenceLabel(date, startTime) {
  const [y, m, d] = String(date).split('-');
  return `${d}.${m}.${y} ${startTime}`;
}

// Minor units → WooCommerce decimal price string ("45.00"). Undefined when no
// price is known (the reconciler then leaves the variation price untouched).
export function minorToWooPrice(minor) {
  if (minor == null) return undefined;
  return (Number(minor) / 100).toFixed(2);
}

// Read a meta value from a WooCommerce variation's meta_data array.
export function metaValue(variation, key) {
  const row = (variation?.meta_data || []).find((m) => m.key === key);
  return row ? row.value : undefined;
}

// Find the existing variation for a TourEvent by our stable meta link (adoption
// path when the stored id was lost). tourEventId is a cuid string.
export function findVariationForTour(variations, tourEventId) {
  return (variations || []).find((v) => String(metaValue(v, META_TOUREVENT_ID)) === String(tourEventId)) || null;
}

// Build the WooCommerce variation payload. `disabled` collapses to a HIDDEN,
// zero-stock, unpurchasable variation (cancelled/completed/postponed/closed) —
// the reconciler NEVER deletes, so orders keep their integrity.
//   tour: { id, status, date, startTime }
//   capacity: the ONE canonical capacity (shared across all cards on the tour)
//   remaining: capacity − active registration seats (derived; shared)
//   priceMinor: the card's representative ticket price (or null → leave as-is)
export function buildVariationPayload({
  tour,
  cardGroupId,
  capacity,
  remaining,
  priceMinor,
  dateAttribute,
  registrationClosed = false,
}) {
  const hasDate = Boolean(tour.date && tour.startTime);
  const disabled = tour.status !== 'scheduled' || !hasDate || registrationClosed;
  const stock = Math.max(0, Number.isFinite(remaining) ? remaining : 0);

  const payload = {
    manage_stock: true,
    stock_quantity: disabled ? 0 : stock,
    stock_status: !disabled && stock > 0 ? 'instock' : 'outofstock',
    // published vs hidden: a disabled occurrence goes 'private' (hidden from the
    // store) but is preserved for order history.
    status: disabled ? 'private' : 'publish',
    meta_data: [
      { key: META_TOUREVENT_ID, value: tour.id },
      { key: META_CARD_GROUP_ID, value: cardGroupId },
      { key: META_CAPACITY, value: capacity == null ? '' : String(capacity) },
      { key: META_DATE, value: tour.date || '' },
      { key: META_START_TIME, value: tour.startTime || '' },
    ],
  };
  // Only (re)write the date attribute when we actually have an occurrence date —
  // a postponed tour keeps whatever attribute it already had (just hidden).
  if (hasDate) {
    payload.attributes = [{ name: dateAttribute, option: occurrenceLabel(tour.date, tour.startTime) }];
  }
  const price = minorToWooPrice(priceMinor);
  if (price !== undefined) payload.regular_price = price;
  return payload;
}

// ── Global-taxonomy, multi-variation model (the LIVE store) ──────────────────
// The real store keys occurrences with GLOBAL taxonomy attributes (pa_תאריך,
// pa_שעה), splits the "tour" vs "tour + workshop" cards through pa_פעילות, and
// sells adult vs child as SEPARATE variations through pa_גיל — each at its own
// price. So ONE occurrence + ONE card → one variation PER ticket type, and the
// card's real per-ticket price is preserved (no first-price collapse).

// GOS owns the occurrence dates/times, so their term names/slugs are derived
// deterministically. WooCommerce slugifies "/" and ":" to "-"/"" — we match:
//   01/07/2026 → slug 01-07-2026 ;  07:00 → slug 0700
export function dateTermName(date) {
  const [y, m, d] = String(date).split('-');
  return `${d}/${m}/${y}`;
}
export function dateTermSlug(date) {
  const [y, m, d] = String(date).split('-');
  return `${d}-${m}-${y}`;
}
export function timeTermName(startTime) {
  return String(startTime);
}
export function timeTermSlug(startTime) {
  return String(startTime).replace(/:/g, '');
}

// Adopt an existing variation by our stable per-VARIANT meta link, for recovery
// when the stored WooVariationLink id was lost. Matches on tour + CARD + variant
// key: ticket types (מבוגר/ילד) are shared across cards, so the variant key alone
// collides when two cards live on the SAME product (tour-only vs tour+workshop) —
// without the card match, the tour-only adult would adopt and overwrite the
// workshop adult variation.
export function findVariationForVariant(variations, tourEventId, cardGroupId, variantKey) {
  return (
    (variations || []).find(
      (v) =>
        String(metaValue(v, META_TOUREVENT_ID)) === String(tourEventId) &&
        String(metaValue(v, META_CARD_GROUP_ID)) === String(cardGroupId) &&
        String(metaValue(v, META_VARIANT_KEY)) === String(variantKey),
    ) || null
  );
}

// The desired set of variations for ONE (occurrence × card). Returns
//   [{ variantKey, ticketTypeId, priceMinor, payload }]
// one entry per priced ticket row. `config` is the mapping's per-product
// descriptor (see WooProductMapping). `ticketRows` come from deriveTicketRows —
// each already carries its own canonical unitPriceMinor.
//   capacity/remaining: the ONE canonical, occurrence-wide values shared by every
//   sibling variation (siblings can never advertise divergent stock).
export function buildOccurrenceVariations({
  tour,
  cardGroupId,
  ticketRows,
  config,
  capacity,
  remaining,
  registrationClosed = false,
}) {
  const cfg = config || {};
  const hasDate = Boolean(tour.date && tour.startTime);
  const disabled = tour.status !== 'scheduled' || !hasDate || registrationClosed;
  const stock = Math.max(0, Number.isFinite(remaining) ? remaining : 0);

  // Attributes shared by every sibling variation of this occurrence+card.
  const sharedAttributes = [];
  if (hasDate && cfg.date?.attrId != null) {
    sharedAttributes.push({ id: cfg.date.attrId, option: dateTermSlug(tour.date) });
  }
  if (hasDate && cfg.time?.attrId != null) {
    sharedAttributes.push({ id: cfg.time.attrId, option: timeTermSlug(tour.startTime) });
  }
  if (cfg.activity?.attrId != null && cfg.activity.option) {
    sharedAttributes.push({ id: cfg.activity.attrId, option: cfg.activity.option });
  }

  const rows = ticketRows && ticketRows.length ? ticketRows : [];
  return rows.map((row) => {
    const variantKey = row.ticketTypeId || 'default';
    const attributes = [...sharedAttributes];

    // Age is the per-ticket dimension. If the product splits age, EVERY priced
    // ticket type MUST map to an age term — refusing to guess prevents selling
    // an adult ticket under the child variation (or an ambiguous collision).
    if (cfg.age?.attrId != null) {
      const term = cfg.ticketAge?.[variantKey];
      if (!term || !term.option) {
        throw new Error(`woo: ticket type ${variantKey} has no age term mapped in config`);
      }
      attributes.push({ id: cfg.age.attrId, option: term.option });
    }

    const payload = {
      manage_stock: true,
      stock_quantity: disabled ? 0 : stock,
      stock_status: !disabled && stock > 0 ? 'instock' : 'outofstock',
      status: disabled ? 'private' : 'publish',
      meta_data: [
        { key: META_TOUREVENT_ID, value: tour.id },
        { key: META_CARD_GROUP_ID, value: cardGroupId },
        { key: META_TICKET_TYPE_ID, value: row.ticketTypeId || '' },
        { key: META_VARIANT_KEY, value: variantKey },
        { key: META_CAPACITY, value: capacity == null ? '' : String(capacity) },
        { key: META_DATE, value: tour.date || '' },
        { key: META_START_TIME, value: tour.startTime || '' },
      ],
    };
    // Only (re)write attributes when we have a concrete occurrence — a postponed
    // tour keeps whatever attributes it already had (just hidden).
    if (hasDate) payload.attributes = attributes;

    const price = minorToWooPrice(row.unitPriceMinor);
    if (price !== undefined) payload.regular_price = price;

    return { variantKey, ticketTypeId: row.ticketTypeId || null, priceMinor: row.unitPriceMinor ?? null, payload };
  });
}
