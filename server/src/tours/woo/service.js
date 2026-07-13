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
//
// It also atomically BUMPS wooDesiredRevision — the canonical sellable-state
// revision. Because every existing dirty-marker already spreads this patch, they
// all bump the revision for free. The worker records the revision it synced
// (wooSyncedRevision); the sweep re-pends any tour whose desired ≠ synced, so a
// mutation that changed sellable state can NEVER stay falsely 'synced' (even one
// that raced an in-progress sync). Structural, not per-route bookkeeping.
export function wooPendingPatch() {
  return {
    wooSyncStatus: 'pending',
    wooAttempts: 0,
    wooNextRetryAt: null,
    wooDesiredRevision: { increment: 1 },
  };
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
// THE canonical "a tour's sellable state changed → converge Woo" entry point.
// Bumps the desired revision + marks pending + kicks the worker. Every standalone
// invalidation should call this (route data-object mutations spread
// wooPendingPatch() instead, which does the same bump inline).
export async function markTourWooDirty(client, tourEventId) {
  await client.tourEvent.updateMany({ where: { id: tourEventId }, data: wooPendingPatch() });
  kickWooSync();
}

// Back-compat alias — existing callers keep working and now get the revision bump.
export const markTourWooPending = markTourWooDirty;
