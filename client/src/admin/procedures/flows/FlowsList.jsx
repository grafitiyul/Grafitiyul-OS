// Placeholder until slice 3 (flows builder). Keeps the same tab layout
// shape (list pane + work area) so the shell feels consistent.
export default function FlowsList() {
  return (
    <div className="h-full flex">
      <aside className="flex w-full lg:w-[360px] lg:shrink-0 lg:border-l lg:border-gray-200 bg-white flex-col min-h-0">
        <div className="p-3 border-b border-gray-200 space-y-2 bg-white">
          <input
            type="search"
            placeholder="חיפוש זרימה..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-50"
            disabled
          />
          <button
            className="w-full border border-blue-200 text-blue-700 bg-blue-50 rounded-md px-3 py-2 text-sm font-medium opacity-60 cursor-not-allowed"
            disabled
            title="יתווסף בשלב הבא"
          >
            + זרימה חדשה
          </button>
          <div className="flex gap-1 text-xs">
            {['הכל', 'טיוטות', 'פורסמו', 'ממתינים'].map((chip) => (
              <span
                key={chip}
                className="px-2 py-1 rounded-full border border-gray-200 text-gray-500 bg-gray-50"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="max-w-xs">
            <div className="text-4xl mb-3 opacity-50">◫</div>
            <div className="font-semibold text-gray-800 mb-1">עדיין אין זרימות</div>
            <div className="text-sm text-gray-500">
              בונה הזרימות יתווסף בשלב הבא.
            </div>
          </div>
        </div>
      </aside>
      <section className="hidden lg:flex flex-1 items-center justify-center bg-gray-50 p-10">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4 opacity-40">◫</div>
          <div className="text-lg font-semibold text-gray-800 mb-1">
            בחרו זרימה לעריכה
          </div>
          <div className="text-sm text-gray-500">
            הרשימה מימין מציגה את כל הזרימות.
          </div>
        </div>
      </section>
    </div>
  );
}
