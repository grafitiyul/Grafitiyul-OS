// The ONE vocabulary for TicketRegistration allocation status + the sets every
// consumer (occupancy, derivation, guide portal, ops control) shares, so no
// surface can disagree about what "counts".
//
// Lifecycle: held → confirmed | expired | cancelled (and refunded). 'active' is
// the LEGACY synonym for confirmed (pre-lifecycle rows + the deal-WON path that
// still writes 'active'); it counts and is treated as a confirmed customer.

export const REG_HELD = 'held';
export const REG_CONFIRMED = 'confirmed';
export const REG_ACTIVE = 'active'; // legacy = confirmed
export const REG_EXPIRED = 'expired';
export const REG_CANCELLED = 'cancelled';
export const REG_REFUNDED = 'refunded';

// Consume capacity AND participate in operational-product derivation. A HELD
// reservation holds a seat and contributes its product just like a confirmed one
// (the tour must be staffed/derived for probable arrivals).
export const CAPACITY_STATUSES = [REG_ACTIVE, REG_HELD, REG_CONFIRMED];

// A CONFIRMED customer — full guide visibility, a real (paid/committed) booking.
// HELD is deliberately excluded (probable, not confirmed → no guide comms).
export const CONFIRMED_STATUSES = [REG_ACTIVE, REG_CONFIRMED];

// Terminal, seat-released states.
export const RELEASED_STATUSES = [REG_EXPIRED, REG_CANCELLED, REG_REFUNDED];

export function countsForCapacity(status) {
  return CAPACITY_STATUSES.includes(status);
}
export function isConfirmed(status) {
  return CONFIRMED_STATUSES.includes(status);
}
export function isHeld(status) {
  return status === REG_HELD;
}
