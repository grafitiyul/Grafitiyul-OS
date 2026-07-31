// Open Tour DEACTIVATION lifecycle — the missing half of generation.
//
// Generation checks `template.active` only to stop creating NEW slots; nothing
// ever reconciled the slots that already existed, so disabling a template (or
// deleting its schedule rules, which is what the settings flow actually does)
// left every generated future slot alive: on the calendar, in Google, and
// purchasable on Woo. Found on production 2026-07-31 with 26 orphaned test
// slots.
//
// THE RULE (owner):
//   * a future generated slot with NO active registrations and NO active
//     bookings is cancelled — the CANONICAL cancel (same field-set and hooks as
//     the manual cancel in routes/tours.js): Google event deleted by the
//     calendar worker, Woo variation drafted/zero-stocked by the woo worker,
//     assignments and payroll cancelled, gallery cleanup scheduled, timeline
//     event recorded;
//   * a slot WITH registrations or bookings is KEPT — it has participants.
//
// Cancelled, not hard-deleted: cancellation is what every worker already
// understands (tombstones, variation drafting, portal hiding), it leaves no
// active-future-tour surface anywhere, and it preserves the audit trail. A hard
// delete would strand the Woo link rows and bypass the teardown machinery.

import { wooPendingPatch, kickWooSync } from './woo/service.js';
import { calendarPendingPatch, kickTourCalendarSync } from './calendar/service.js';
import { cancelTourAssignments } from './assignmentLifecycle.js';
import { cancelTourPayroll } from '../payroll/service.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { scheduleGalleryCleanup } from './gallery/service.js';

/**
 * Reconcile a template's generated future slots after deactivation (template
 * switched off OR its rules deleted/deactivated). Idempotent: an already
 * cancelled slot is not scheduled, so a rerun touches nothing.
 */
export async function reconcileOpenTourDeactivation(client, templateId, { origin = null, log = console } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const slots = await client.tourEvent.findMany({
    where: { openTourTemplateId: templateId, status: 'scheduled' },
    select: { id: true, date: true, startTime: true },
  });
  const future = slots.filter((s) => String(s.date).slice(0, 10) >= today);

  const cancelled = [];
  const kept = [];
  for (const s of future) {
    const [regs, bookings] = await Promise.all([
      client.ticketRegistration.count({ where: { tourEventId: s.id, status: { in: ['held', 'confirmed', 'active'] } } }),
      client.booking.count({ where: { tourEventId: s.id, status: 'active' } }),
    ]);
    if (regs > 0 || bookings > 0) {
      kept.push({ id: s.id, date: s.date, startTime: s.startTime, regs, bookings });
      continue;
    }

    await client.tourEvent.update({
      where: { id: s.id },
      data: {
        status: 'cancelled',
        ...calendarPendingPatch(), // the calendar worker deletes the Google event
        ...wooPendingPatch('template_deactivation'), // the woo worker drafts + zero-stocks the variation
      },
    });
    await emitTimelineEvent(client, {
      subjectType: 'tour_event',
      subjectId: s.id,
      kind: 'tour',
      data: { event: 'status_changed', from: 'scheduled', to: 'cancelled', reason: 'open_tour_template_deactivated' },
      origin,
    }).catch((e) => log?.error?.('[open-tours] timeline emit failed', e?.message));
    await scheduleGalleryCleanup(client, s.id, { reason: 'tour_cancelled', origin })
      .catch((e) => log?.error?.('[open-tours] gallery cleanup failed', e?.message));
    await cancelTourPayroll(client, s.id, 'tour_cancelled')
      .catch((e) => log?.error?.('[open-tours] payroll cancel failed', e?.message));
    await cancelTourAssignments(client, s.id, { origin, reason: 'tour_cancelled' })
      .catch((e) => log?.error?.('[open-tours] assignment cancel failed', e?.message));

    cancelled.push({ id: s.id, date: s.date, startTime: s.startTime });
  }

  if (cancelled.length) {
    kickTourCalendarSync();
    kickWooSync();
  }
  log?.log?.(`[open-tours] deactivation reconcile for ${templateId}: cancelled ${cancelled.length} empty future slot(s), kept ${kept.length} with participants`);
  return { cancelled, kept, scanned: future.length };
}
