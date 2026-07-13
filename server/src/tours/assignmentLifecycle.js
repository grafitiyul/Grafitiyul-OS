import { emitTimelineEvent } from '../timeline/events.js';

// Canonical removal of a tour's staff assignments when the tour is cancelled or
// replaced. TourAssignment is the LIVE operational link (the model has no soft
// status — an assignment either exists or it doesn't, and it is removed via
// delete, exactly as the WON re-materialize path already does). Its audit trail
// lives on the timeline, so we record the removal there rather than orphaning a
// guide on a cancelled tour. Idempotent: a tour with no assignments is a no-op.
//
// The Guide Portal already hides cancelled/postponed tours and 403s direct
// access; removing the assignment makes the guide no longer OPERATIONALLY
// assigned (admin views, calendar, payroll all follow from the tour being
// cancelled). Reopen re-materializes team from the canonical plan layer.
export async function cancelTourAssignments(client, tourEventId, { origin = null, reason = 'tour_cancelled' } = {}) {
  const assignments = await client.tourAssignment.findMany({
    where: { tourEventId },
    select: { id: true, externalPersonId: true, role: true },
  });
  if (!assignments.length) return { removed: 0, assignments: [] };
  await client.tourAssignment.deleteMany({ where: { tourEventId } });
  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    data: {
      event: 'assignments_removed',
      reason,
      assignments: assignments.map((a) => ({ personId: a.externalPersonId, role: a.role })),
    },
    origin,
  }).catch(() => {});
  return { removed: assignments.length, assignments };
}
