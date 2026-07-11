import { Link } from 'react-router-dom';
import { edgeAccentStyle } from '../../color/staffColorUi.js';
import {
  ACTIVITY_LABELS,
  ROLE_LABELS,
  ROLE_STYLES,
  fmtDayLineHe,
  isToday,
  participantsLabel,
} from '../format.js';

// One tour card — shared by the upcoming and past feeds. Pure presentation:
// everything shown comes from the guide tour-card DTO. Cancelled tours never
// reach the portal (server rule) so there is no cancelled styling here.

export default function TourCard({ token, tour }) {
  const today = isToday(tour.date);

  return (
    <Link
      to={`/p/${encodeURIComponent(token)}/tour/${encodeURIComponent(tour.id)}`}
      // Guide identity accent — server-derived canonical color (the tour's
      // lead/single guide), rendered as a start-edge stripe.
      style={edgeAccentStyle(tour.guideColor)}
      className={`block rounded-2xl border bg-white p-4 shadow-sm transition active:bg-gray-50 ${
        today ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-bold leading-snug text-gray-900">
            {tour.variantName}
          </div>
          <div className="mt-1 text-[13px] text-gray-600">
            {fmtDayLineHe(tour.date)} ·{' '}
            <span dir="ltr" className="tabular-nums font-semibold">
              {tour.startTime}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {today && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
              היום
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
        {ACTIVITY_LABELS[tour.activityType] && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
            {ACTIVITY_LABELS[tour.activityType]}
          </span>
        )}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-700">
          {participantsLabel(tour.participantsTotal)}
        </span>
        {ROLE_LABELS[tour.role] && (
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              ROLE_STYLES[tour.role] || 'bg-gray-100 text-gray-700'
            }`}
          >
            {ROLE_LABELS[tour.role]}
          </span>
        )}
      </div>
    </Link>
  );
}
