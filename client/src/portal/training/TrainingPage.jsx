import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

// מערכי הדרכה — the guide's permitted training content. The API already
// returns ONLY permitted tours/stations (double server gate); this page just
// renders what it gets:
//   * multiple tours  → tour list; opening one shows its permitted stations
//   * exactly one tour → skip the selector, land straight on its stations
//   * nothing granted → polished honest empty state (no fake "בקרוב")

export function useTrainingFeed(token) {
  const [state, setState] = useState({ phase: 'loading' });
  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/training`, {
        cache: 'no-store',
      });
      if (res.status === 403) return setState({ phase: 'forbidden' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({ phase: 'ready', tours: data.tours || [] });
    } catch (e) {
      setState({ phase: 'error', message: e?.message || 'שגיאה' });
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

export function TrainingStates({ state, children }) {
  if (state.phase === 'loading') {
    return <div className="py-10 text-center text-sm text-gray-500">טוען…</div>;
  }
  if (state.phase === 'forbidden') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        מערכי ההדרכה אינם זמינים.
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-1 text-base font-semibold text-gray-800">
          שגיאה בטעינת מערכי ההדרכה
        </div>
        <button
          type="button"
          onClick={state.reload}
          className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          נסה שוב
        </button>
      </div>
    );
  }
  return children;
}

const KIND_ICONS = {
  location: '📍',
  artwork: '🎨',
  printed_material: '📄',
  content_stop: '📖',
};

export function StationList({ token, tour }) {
  return (
    <div className="space-y-2">
      {tour.stations.map((s) => (
        <Link
          key={s.id}
          to={`/p/${encodeURIComponent(token)}/training/stations/${encodeURIComponent(s.id)}`}
          className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm active:bg-gray-50"
        >
          {s.heroImageUrl ? (
            <img
              src={s.heroImageUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl border border-gray-100 object-cover"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-xl">
              {KIND_ICONS[s.kind] || '📍'}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold text-gray-900">
              {s.titleHe}
            </span>
            {s.descriptionHe && (
              <span className="block truncate text-[12px] text-gray-500">{s.descriptionHe}</span>
            )}
          </span>
          <span className="text-gray-300">‹</span>
        </Link>
      ))}
    </div>
  );
}

export default function TrainingPage() {
  const { token } = useOutletContext();
  const state = useTrainingFeed(token);

  return (
    <TrainingStates state={state}>
      {state.tours && state.tours.length === 0 && (
        <div>
          <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">מערכי הדרכה</h1>
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <div className="mb-3 text-4xl opacity-60">🎓</div>
            <div className="mb-1 text-base font-semibold text-gray-800">
              אין עדיין תוכן הדרכה זמין עבורך
            </div>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-gray-500">
              כשהמשרד יפתח עבורך מערכי הדרכה, התחנות שלהם יופיעו כאן.
            </p>
          </div>
        </div>
      )}

      {/* One permitted tour → land straight on its stations (even when only
          some of that tour's stations are permitted). */}
      {state.tours && state.tours.length === 1 && (
        <div>
          <h1 className="mb-1 px-1 text-[17px] font-bold text-gray-900">
            {state.tours[0].titleHe}
          </h1>
          {state.tours[0].descriptionHe && (
            <p className="mb-3 px-1 text-[13px] text-gray-500">
              {state.tours[0].descriptionHe}
            </p>
          )}
          {!state.tours[0].descriptionHe && <div className="mb-3" />}
          <StationList token={token} tour={state.tours[0]} />
        </div>
      )}

      {state.tours && state.tours.length > 1 && (
        <div>
          <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">מערכי הדרכה</h1>
          <div className="space-y-2">
            {state.tours.map((t) => (
              <Link
                key={t.id}
                to={`/p/${encodeURIComponent(token)}/training/tours/${encodeURIComponent(t.id)}`}
                className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm active:bg-gray-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-xl" aria-hidden>
                  🎓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-gray-900">
                    {t.titleHe}
                  </span>
                  <span className="block text-[12px] text-gray-500">
                    {t.stations.length === 1 ? 'תחנה אחת' : `${t.stations.length} תחנות`}
                  </span>
                </span>
                <span className="text-gray-300">‹</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </TrainingStates>
  );
}

// Stations of ONE tour (the multi-tour case's second screen).
export function TrainingTourPage() {
  const { token } = useOutletContext();
  const { tourId } = useParams();
  const state = useTrainingFeed(token);
  const tour = state.tours?.find((t) => t.id === tourId) || null;

  return (
    <TrainingStates state={state}>
      {state.tours &&
        (tour ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Link
                to={`/p/${encodeURIComponent(token)}/training`}
                aria-label="חזרה למערכי ההדרכה"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 active:bg-gray-100"
              >
                →
              </Link>
              <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold text-gray-900">
                {tour.titleHe}
              </h1>
            </div>
            <StationList token={token} tour={tour} />
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            מערך ההדרכה אינו זמין.
          </div>
        ))}
    </TrainingStates>
  );
}
