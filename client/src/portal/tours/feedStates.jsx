// Loading / error states for the tour feeds — kept together so upcoming and
// past render identical resilience behavior.

export function FeedSkeleton() {
  return (
    <div className="space-y-3" aria-label="טוען סיורים" role="status">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4">
          <div className="h-4 w-2/3 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-1/2 rounded bg-gray-100" />
          <div className="mt-3 flex gap-1.5">
            <div className="h-5 w-20 rounded-full bg-gray-100" />
            <div className="h-5 w-24 rounded-full bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeedError({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
      <div className="mb-3 text-4xl opacity-50">📡</div>
      <div className="mb-1 text-base font-semibold text-gray-800">שגיאה בטעינת הסיורים</div>
      {message && (
        <div className="mb-2 text-[12px] font-mono text-gray-400" dir="ltr">
          {message}
        </div>
      )}
      <button
        type="button"
        onClick={() => onRetry()}
        className="mt-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 active:bg-gray-100"
      >
        נסה שוב
      </button>
    </div>
  );
}
