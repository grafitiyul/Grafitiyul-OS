import { Link } from 'react-router-dom';
import {
  ROLE_STYLES,
  activityLabel,
  fmtDayLine,
  isToday,
  participantsLabel,
  roleLabel,
} from '../format.js';
import { usePortalLanguage } from '../PortalLanguage.jsx';

// One tour card — shared by the upcoming and past feeds. Pure presentation:
// everything shown comes from the guide tour-card DTO, which the server already
// resolved into the guide's language (product · city). Cancelled tours never
// reach the portal (server rule) so there is no cancelled styling here.

export default function TourCard({ token, tour }) {
  const { lang, t } = usePortalLanguage();
  const today = isToday(tour.date);

  return (
    <Link
      to={`/p/${encodeURIComponent(token)}/tour/${encodeURIComponent(tour.id)}`}
      className={`block rounded-2xl border bg-white p-4 shadow-sm transition active:bg-gray-50 ${
        today ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-bold leading-snug text-gray-900">
            {/* variantName is DATA (product · city), already language-resolved
                server-side; the generic word is the only part we own. */}
            {tour.variantName || t.tours.untitledTour}
          </div>
          <div className="mt-1 text-[13px] text-gray-600">
            {fmtDayLine(tour.date, lang)} ·{' '}
            <span dir="ltr" className="tabular-nums font-semibold">
              {tour.startTime}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {today && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
              {t.tours.today}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
        {activityLabel(tour.activityType, lang) && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
            {activityLabel(tour.activityType, lang)}
          </span>
        )}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-700">
          {participantsLabel(tour.participantsTotal, lang)}
        </span>
        {roleLabel(tour.role, lang) && (
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              ROLE_STYLES[tour.role] || 'bg-gray-100 text-gray-700'
            }`}
          >
            {roleLabel(tour.role, lang)}
          </span>
        )}
      </div>
    </Link>
  );
}
