import { kickTourCalendarSync } from './syncWorker.js';
import { israelToday } from '../../lib/israelDate.js';

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

// A tour's Google attendee list is derived from TourAssignment.personRef.email
// (calendar/desiredState.js eventAttendees). That means the desired event state
// depends on TWO inputs: the tour row, and the assigned people's identities.
// Every tour-side input already marks the tour dirty (patchTouchesCalendar,
// assignment add/remove). The PERSON-side input had no trigger at all — a guide
// assigned before their email existed stayed uninvited forever, because nothing
// re-pended their tours when the email arrived.
//
// This is the missing symmetric mark, and it lives here for the same reason the
// others do: this module is the ONLY writer of gcalSyncStatus outside the sync
// worker. Nothing here talks to Google — it sets the dirty flag and the
// existing reconciler derives and diffs the event exactly as it always does.
//
//   * FUTURE tours only — history is never re-invited (same rule as
//     sweepUnsyncedTours).
//   * Idempotent — a row already 'pending' is left alone, so repeated calls
//     cannot reset an in-flight retry ladder.
//   * No duplicate guests — the reconciler compares attendees as a set of
//     lowercased emails and patches minimally.
//   * No unnecessary calendar updates — if the desired event already matches
//     Google, diffEvent returns null and NO API call is made. Over-marking
//     costs one read, never a guest notification.
export async function markGuideFutureToursCalendarPending(client, personRefId, nowMs = Date.now()) {
  if (!personRefId) return 0;
  const today = israelToday(nowMs);
  const res = await client.tourEvent.updateMany({
    where: {
      status: 'scheduled',
      date: { gte: today },
      assignments: { some: { personRefId } },
      // Leave in-flight work alone; 'pending' already means "will reconcile".
      NOT: { gcalSyncStatus: 'pending' },
    },
    data: calendarPendingPatch(),
  });
  if (res.count > 0) kickTourCalendarSync();
  return res.count;
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
