import { kickWooSync } from './syncWorker.js';

// Woo-sync outbox helpers — the ONLY writers of wooSyncStatus outside the sync
// worker. Route/service code never talks to WooCommerce directly: a mutation
// marks the tour dirty ('pending') and the worker derives the full desired
// variation state from canonical GOS rows (the SSOT), immediately via the kick
// with the 60s tick as the recovery/backfill fallback. Same contract as the
// Google Calendar outbox.

export { kickWooSync };

// Patch fragment spread into a caller's own `data` object. Resets the retry
// ladder so a fresh mutation gets fresh attempts even after a previous 'failed'.
export function wooPendingPatch() {
  return { wooSyncStatus: 'pending', wooAttempts: 0, wooNextRetryAt: null };
}

// TourEvent fields whose change is visible on the Woo variation (date/time =
// occurrence attribute, status = published/hidden + cancellation, product =
// price/label, capacity = stock).
const WOO_RELEVANT_KEYS = ['date', 'startTime', 'status', 'productId', 'productVariantId', 'capacity'];

export function patchTouchesWoo(data) {
  return WOO_RELEVANT_KEYS.some((k) => data[k] !== undefined);
}

// Standalone mark for mutations that don't build a TourEvent `data` object
// (registration changes → stock; occurrence overrides). updateMany so a
// concurrently-deleted tour is a silent no-op.
export async function markTourWooPending(client, tourEventId) {
  await client.tourEvent.updateMany({ where: { id: tourEventId }, data: wooPendingPatch() });
  kickWooSync();
}
