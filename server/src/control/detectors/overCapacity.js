import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { occupancyFor } from '../../tours/occupancy.js';

// A scheduled open tour whose ACTIVE registration seats exceed its capacity.
// Overbook is ALLOWED (website orders never fail on capacity; admin can override
// explicitly; late payment re-confirms over capacity) — but it must be visible
// and actionable. Re-derived from live occupancy: auto-raises when over, auto-
// resolves when seats drop back to/under capacity.

const TYPE = 'tour_over_capacity';
const dedupeKey = (tourId) => `${TYPE}:${tourId}`;

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function buildPayload(tour, seats) {
  const when = [fmtDate(tour.date), tour.startTime].filter(Boolean).join(' ');
  const product = tour.product?.nameHe || 'סיור';
  return {
    type: TYPE,
    severity: 'warning',
    sourceModule: 'tours',
    dedupeKey: dedupeKey(tour.id),
    title: `חריגה מקיבולת — ${product} ${when}`.trim(),
    explanation:
      `בסיור רשומים ${seats} משתתפים מתוך קיבולת ${tour.capacity}. ` +
      'החריגה מותרת (הזמנות אתר לעולם לא נדחות על קיבולת, ותשלום מאוחר משחזר את המקום), ' +
      'אך כדאי לוודא היערכות תפעולית (צוות/מקום) או להתאים קיבולת.',
    entityRefs: [{ type: 'tour_event', id: tour.id, label: when || 'סיור' }],
    data: { tourEventId: tour.id, seats, capacity: tour.capacity, over: seats - tour.capacity },
  };
}

registerDetector({
  key: 'tour-over-capacity',
  async run(client) {
    const tours = await client.tourEvent.findMany({
      where: { kind: 'group_slot', status: 'scheduled', capacity: { not: null } },
      select: { id: true, date: true, startTime: true, capacity: true, product: { select: { nameHe: true } } },
      take: 2000,
    });
    if (!tours.length) {
      await resolveMissing(client, TYPE, new Set());
      return;
    }
    const occ = await occupancyFor(client, tours.map((t) => t.id));
    const present = new Set();
    for (const t of tours) {
      const seats = occ[t.id]?.activeSeats || 0;
      if (seats <= t.capacity) continue;
      present.add(dedupeKey(t.id));
      await raiseIssue(client, buildPayload(t, seats));
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  sourceModule: 'tours',
  buildActions(issue) {
    return [
      { key: 'open_tour', label: 'פתח סיור', kind: 'link', style: 'primary', target: { type: 'tour_event', id: issue.data?.tourEventId } },
    ];
  },
  async recheck(client, issue) {
    const tour = await client.tourEvent.findUnique({ where: { id: issue.data?.tourEventId }, select: { capacity: true, status: true } });
    if (!tour || tour.capacity == null || tour.status !== 'scheduled') return false;
    const occ = await occupancyFor(client, [issue.data.tourEventId]);
    return (occ[issue.data.tourEventId]?.activeSeats || 0) > tour.capacity;
  },
});
