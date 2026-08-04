import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import TourCard from './TourCard.jsx';
import useToursFeed from './useToursFeed.js';
import { FeedSkeleton, FeedError } from './feedStates.jsx';
import { pastYears, pastMonths, filterPastTours } from './pastFilter.js';
import { monthName } from '../format.js';
import { usePortalLanguage } from '../PortalLanguage.jsx';

// סיורי עבר — tours whose end time has passed, newest first. A permanent tab:
// completed tours move here for their assigned guides (not permission-gated).
// The forbidden state below covers portal-level 403s only (portal disabled).
//
// Month/year filter: guides with long histories jump straight to a period.
// Options derive from the loaded feed (only real years/months are offered);
// picking a year narrows the month options, and an impossible month resets.

export default function PastToursPage() {
  const { token } = useOutletContext();
  const { lang, t } = usePortalLanguage();
  const { phase, tours, message, reload } = useToursFeed(token, 'past');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');

  const list = tours || [];
  const years = useMemo(() => pastYears(list), [list]);
  const months = useMemo(() => pastMonths(list, year), [list, year]);
  const filtered = useMemo(
    () => filterPastTours(list, { year, month }),
    [list, year, month],
  );

  if (phase === 'loading' && !tours) return <FeedSkeleton />;
  if (phase === 'forbidden') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        {t.tours.pastForbidden}
      </div>
    );
  }
  if (phase === 'error') return <FeedError message={message} onRetry={reload} />;

  function pickYear(y) {
    setYear(y);
    // A month that no longer exists under the new year must not stick.
    if (month && !pastMonths(list, y).includes(month)) setMonth('');
  }

  const restricted = !!(year || month);

  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">{t.tours.pastTitle}</h1>

      {list.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterSelect
            value={year}
            onChange={pickYear}
            allLabel={t.tours.allYears}
            options={years.map((y) => ({ value: y, label: y }))}
            ariaLabel={t.tours.filterYearAria}
          />
          <FilterSelect
            value={month}
            onChange={setMonth}
            allLabel={t.tours.allMonths}
            options={months.map((m) => ({ value: m, label: monthName(m, lang) }))}
            ariaLabel={t.tours.filterMonthAria}
          />
          {restricted && (
            <button
              type="button"
              onClick={() => {
                setYear('');
                setMonth('');
              }}
              className="text-[12.5px] font-medium text-blue-700 active:opacity-70"
            >
              {t.tours.clearFilter}
            </button>
          )}
          {/* ms-auto is a LOGICAL margin — it pushes to the trailing edge in
              both directions with no mirroring needed. */}
          <span className="ms-auto text-[12px] text-gray-400 tabular-nums">
            {t.tours.countTours(filtered.length)}
          </span>
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl opacity-50">🕘</div>
          <div className="mb-1 text-base font-semibold text-gray-800">{t.tours.pastEmptyTitle}</div>
          <div className="text-sm text-gray-500">{t.tours.pastEmptyBody}</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t.tours.noneInPeriod}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((tour) => (
            <TourCard key={tour.id} token={token} tour={tour} />
          ))}
        </div>
      )}
    </div>
  );
}

// Compact mobile-friendly select — native <select> (best touch UX on phones),
// styled like the portal chips; blue tint while restricting. The native control
// inherits direction from the document, so nothing is mirrored by hand.
function FilterSelect({ value, onChange, options, allLabel, ariaLabel }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={`h-9 rounded-xl border px-2.5 text-[13px] font-medium focus:outline-none ${
        value
          ? 'border-blue-300 bg-blue-50 text-blue-800'
          : 'border-gray-200 bg-white text-gray-700'
      }`}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
