import { useOutletContext } from 'react-router-dom';
import TourCard from './TourCard.jsx';
import useToursFeed from './useToursFeed.js';
import { FeedSkeleton, FeedError } from './feedStates.jsx';

// סיורים — the portal's primary tab. Every future TourEvent the guide has an
// assignment on (any role), soonest first. Cancelled future tours stay
// visible with a clear cancelled state.

export default function UpcomingToursPage() {
  const { token } = useOutletContext();
  const { phase, tours, message, reload } = useToursFeed(token, 'upcoming');

  if (phase === 'loading' && !tours) return <FeedSkeleton />;
  if (phase === 'error') return <FeedError message={message} onRetry={reload} />;

  const list = tours || [];
  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">הסיורים הקרובים</h1>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl opacity-50">🧭</div>
          <div className="mb-1 text-base font-semibold text-gray-800">אין סיורים קרובים</div>
          <div className="text-sm text-gray-500">
            כשתשובץ לסיור חדש הוא יופיע כאן.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((t) => (
            <TourCard key={t.id} token={token} tour={t} />
          ))}
        </div>
      )}
    </div>
  );
}
