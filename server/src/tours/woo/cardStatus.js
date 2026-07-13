// Per-card, per-occurrence sync status — DERIVED from real WooVariationLink
// completeness against the card's desired variation coverage, NOT reused from the
// TourEvent-level outbox flag. The TourEvent flag stays the worker's orchestration
// signal; the UI must show the truth for THIS specific card, which can differ
// (e.g. a tour marked 'synced' whose tour-only card produced zero variations).
//
// Distinguishes: not_offered · unmapped · no_tickets · failed · synced ·
// incomplete · pending · missing.
//   offered:    the card is offered by this tour's template
//   mapped:     an active WooProductMapping exists for the card
//   expected:   number of desired variations (priced ticket rows — adult/child)
//   syncedCount: linked variations with an id and status 'synced'
//   failed:     any of the card's links is 'failed' (or tour is 'failed')
//   tourStatus: the TourEvent-level wooSyncStatus (for pending/failed context)
export function deriveCardStatus({ offered = true, mapped, expected, syncedCount, failed = false, tourStatus = null }) {
  if (!offered) return 'not_offered';
  if (!mapped) return 'unmapped';
  if (!expected) return 'no_tickets';
  if (failed || tourStatus === 'failed') return 'failed';
  if (syncedCount >= expected) return 'synced';
  if (syncedCount > 0) return 'incomplete';
  if (tourStatus === 'pending') return 'pending';
  return 'missing';
}
