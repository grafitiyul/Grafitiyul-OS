import { TOUR_STATUS_LABELS, TOUR_STATUS_STYLES } from './config.js';

// Parallel Tours (admin) — compact, scannable rows for the tours happening
// within ±3h of the viewed tour. Each row links to that tour's admin page
// (/admin/tours/:id) via the same navigation the tours table/calendar use;
// opening it simply swaps the modal to the other tour. Data comes fully shaped
// from the server (canonical parallelTours selector) — this component only
// presents it. The caller renders nothing at all when the list is empty, so
// this component always receives at least one tour.

function countLabel(n) {
  const count = Number(n) || 0;
  return count === 1 ? 'משתתף אחד' : `${count} משתתפים`;
}

function ParallelTourRow({ tour, onOpen }) {
  const staffNames = tour.staff.map((s) => s.displayName).join(' · ');
  return (
    <button
      type="button"
      onClick={() => onOpen(tour.id)}
      className="flex w-full items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50/60 p-2.5 text-right transition hover:border-gray-300 hover:bg-white active:scale-[0.99]"
    >
      <div className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[13px] font-bold tabular-nums text-gray-900">
        {tour.startTime || '—'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-gray-900">
            {tour.variantName || '—'}
          </span>
          {tour.status !== 'scheduled' && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TOUR_STATUS_STYLES[tour.status] || ''}`}
            >
              {TOUR_STATUS_LABELS[tour.status] || tour.status}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-gray-500">
          <span>{countLabel(tour.participantsTotal)}</span>
          {staffNames ? (
            <span className="truncate">{staffNames}</span>
          ) : (
            <span className="text-gray-400">ללא שיבוץ</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function ParallelToursList({ tours, onOpen }) {
  return (
    <div className="space-y-2">
      {tours.map((t) => (
        <ParallelTourRow key={t.id} tour={t} onOpen={onOpen} />
      ))}
    </div>
  );
}
