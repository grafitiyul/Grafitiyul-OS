import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import TourCard from './TourCard.jsx';
import useToursFeed from './useToursFeed.js';
import { FeedSkeleton, FeedError } from './feedStates.jsx';
import { pastYears, pastMonths, filterPastTours, monthLabel } from './pastFilter.js';

// סיורי עבר — tours whose end time has passed, newest first. A permanent tab:
// completed tours move here for their assigned guides (not permission-gated).
// The forbidden state below covers portal-level 403s only (portal disabled).
//
// Month/year filter: guides with long histories jump straight to a period.
// Options derive from the loaded feed (only real years/months are offered);
// picking a year narrows the month options, and an impossible month resets.

export default function PastToursPage() {
  const { token } = useOutletContext();
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
        צפייה בסיורי עבר אינה זמינה.
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
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">סיורי עבר</h1>

      {list.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterSelect
            value={year}
            onChange={pickYear}
            allLabel="כל השנים"
            options={years.map((y) => ({ value: y, label: y }))}
            ariaLabel="סינון לפי שנה"
          />
          <FilterSelect
            value={month}
            onChange={setMonth}
            allLabel="כל החודשים"
            options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
            ariaLabel="סינון לפי חודש"
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
              ניקוי
            </button>
          )}
          <span className="ms-auto text-[12px] text-gray-400 tabular-nums">
            {filtered.length} סיורים
          </span>
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl opacity-50">🕘</div>
          <div className="mb-1 text-base font-semibold text-gray-800">אין עדיין סיורי עבר</div>
          <div className="text-sm text-gray-500">סיורים שהסתיימו יופיעו כאן.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          אין סיורים בתקופה שנבחרה.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <TourCard key={t.id} token={token} tour={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// Compact mobile-friendly select — native <select> (best touch UX on phones),
// styled like the portal chips; blue tint while restricting.
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
