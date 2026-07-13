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
