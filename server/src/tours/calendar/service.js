import { kickTourCalendarSync } from './syncWorker.js';

// Calendar-sync outbox helpers — the ONLY writers of gcalSyncStatus outside
// the sync worker. Route/service code never talks to Google directly: a
// mutation just marks the tour dirty ('pending') and the worker derives the
// full desired event state from the TourEvent row (the SSOT) — immediately
// via the kick below, with the 60s tick as the recovery fallback.

// Re-exported so callers that spread calendarPendingPatch() into their own
// prisma write (tours routes, deal→tour sync) can trigger the immediate run
// AFTER their write/transaction without importing the worker directly.
export { kickTourCalendarSync };

// Patch fragment for updates that already build a `data` object (tour routes,
// deal→tour sync). Resets the retry ladder so a fresh mutation gets fresh
// attempts even after a previous 'failed'.
export function calendarPendingPatch() {
  return { gcalSyncStatus: 'pending', gcalAttempts: 0, gcalNextRetryAt: null };
}

// TourEvent fields whose change is visible on the calendar (title/time/
// duration/cancellation). capacity/notes and assignment ROLES are not.
const CALENDAR_RELEVANT_KEYS = [
  'date',
  'startTime',
  'tourLanguage',
  'productId',
  'productVariantId',
  'status',
];

export function patchTouchesCalendar(data) {
  return CALENDAR_RELEVANT_KEYS.some((k) => data[k] !== undefined);
}

// Standalone mark for mutations on RELATED rows (assignments, workshop
// locations) where no TourEvent patch object exists. updateMany so a
// concurrently-deleted tour is a silent no-op.
export async function markTourCalendarPending(client, tourEventId) {
  await client.tourEvent.updateMany({
    where: { id: tourEventId },
    data: calendarPendingPatch(),
  });
  kickTourCalendarSync();
}

// Called BEFORE deleting a TourEvent row: the Google event must still be
// cancelled (guests get Google's cancellation email), so the event identity
// survives in a tombstone the worker processes asynchronously.
export async function scheduleCalendarTombstone(client, tour) {
  if (!tour?.gcalEventId) return;
  await client.tourCalendarTombstone.create({
    data: {
      tourEventId: tour.id,
      gcalEventId: tour.gcalEventId,
      gcalAccountId: tour.gcalAccountId,
    },
  });
  kickTourCalendarSync();
}
