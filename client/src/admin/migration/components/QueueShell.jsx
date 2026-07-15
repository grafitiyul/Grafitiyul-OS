// Honest empty state for a review queue whose proposal builder is not built yet.
// No fake data, no dead controls — it states plainly what will live here.
export default function QueueShell({ icon, title, description, blocking }) {
  return (
    <div className="h-full flex items-start justify-center p-6">
      <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        <p className="mt-4 inline-block text-[11px] px-2 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-200">
          {blocking ? 'תור חוסם — חייב להסתיים לפני סיום הייבוא' : 'תור לא חוסם'}
        </p>
      </div>
    </div>
  );
}
