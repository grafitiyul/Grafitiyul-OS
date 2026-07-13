import { calendarPendingPatch, kickTourCalendarSync } from '../tours/calendar/service.js';
import { wooPendingPatch, kickWooSync } from '../tours/woo/service.js';
import { emitTourChangeImpact } from '../tours/changeImpact.js';

// One-time, idempotent repair of the QA drift where a group-slot TourEvent was
// re-timed directly (old direct-edit path) but its linked Deals / Woo / Calendar
// were left on the OLD time, and no Operations Control issue was created. Aligns
// every linked Deal snapshot to the TourEvent (the temporary source of truth),
// marks Woo + Calendar dirty, and backfills the missing impact issue.
//
// Runs automatically on boot, is safe on repeated deploy (only touches DRIFTED
// rows; impact issues are deduped), and logs exactly what it changed. Scoped to
// the known QA date by default so it can never sweep unrelated data.

const QA_DATES = ['2026-07-17'];
// The known original time for the QA case (for the backfilled impact's "before").
const QA_OLD_TIME = { '2026-07-17': '11:30' };

export async function repairTourDealDrift(client, { dates = QA_DATES, log = console } = {}) {
  const changed = { deals: [], toursDirty: [], impacts: [] };
  const tours = await client.tourEvent.findMany({
    where: { kind: 'group_slot', date: { in: dates } },
    select: { id: true, date: true, startTime: true, tourLanguage: true, locationId: true, status: true },
  });

  for (const tour of tours) {
    const bookings = await client.booking.findMany({
      where: { tourEventId: tour.id, status: 'active' },
      select: { dealId: true },
    });
    const dealIds = [...new Set(bookings.map((b) => b.dealId).filter(Boolean))];
    let alignedAny = false;
    for (const dealId of dealIds) {
      const deal = await client.deal.findUnique({
        where: { id: dealId },
        select: { id: true, tourDate: true, tourTime: true, locationId: true },
      });
      if (!deal) continue;
      const drifted = deal.tourTime !== tour.startTime || deal.tourDate !== tour.date || deal.locationId !== tour.locationId;
      if (!drifted) continue;
      await client.deal.update({
        where: { id: dealId },
        data: { tourDate: tour.date, tourTime: tour.startTime, tourLanguage: tour.tourLanguage, locationId: tour.locationId },
      });
      changed.deals.push({ dealId, fromTime: deal.tourTime, toTime: tour.startTime, fromDate: deal.tourDate, toDate: tour.date });
      alignedAny = true;
    }

    // If we aligned deals (drift existed), converge Woo + Calendar and backfill
    // the impact issue the original broken edit failed to create.
    if (alignedAny && tour.status === 'scheduled') {
      await client.tourEvent.update({ where: { id: tour.id }, data: { ...calendarPendingPatch(), ...wooPendingPatch() } });
      changed.toursDirty.push(tour.id);
      const issue = await emitTourChangeImpact(client, {
        tourEventId: tour.id,
        impactType: 'tour_time_changed',
        before: { date: tour.date, startTime: QA_OLD_TIME[tour.date] || null },
        after: { date: tour.date, startTime: tour.startTime },
        note: 'one-time data repair (QA drift)',
      }).catch(() => null);
      if (issue) changed.impacts.push(issue.id);
    }
  }

  if (changed.deals.length || changed.toursDirty.length) {
    kickTourCalendarSync();
    kickWooSync();
    log?.log?.(`[repair] tour-deal drift aligned: ${JSON.stringify(changed)}`);
  }
  return changed;
}
