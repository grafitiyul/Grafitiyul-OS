import { useOutletContext } from 'react-router-dom';
import TourCard from './TourCard.jsx';
import useToursFeed from './useToursFeed.js';
import { FeedSkeleton, FeedError } from './feedStates.jsx';

// סיורי עבר — tours whose end time has passed, newest first. A permanent tab:
// completed tours move here for their assigned guides (not permission-gated).
// The forbidden state below covers portal-level 403s only (portal disabled).

export default function PastToursPage() {
  const { token } = useOutletContext();
  const { phase, tours, message, reload } = useToursFeed(token, 'past');

  if (phase === 'loading' && !tours) return <FeedSkeleton />;
  if (phase === 'forbidden') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        צפייה בסיורי עבר אינה זמינה.
      </div>
    );
  }
  if (phase === 'error') return <FeedError message={message} onRetry={reload} />;

  const list = tours || [];
  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">סיורי עבר</h1>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl opacity-50">🕘</div>
          <div className="mb-1 text-base font-semibold text-gray-800">אין עדיין סיורי עבר</div>
          <div className="text-sm text-gray-500">סיורים שהסתיימו יופיעו כאן.</div>
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
