// Left-panel content: the Sales Script workspace. Placeholder for now — this is
// where future selling aids live (script, objections, talking points, AI
// suggestions, reminders, checklists). No data/logic yet; purely a calm preview
// of the structure so the panel reads as intentional, not empty.

const SECTIONS = [
  { title: 'פתיחה', hint: 'בניית קשר, מסגור השיחה, שאלת מטרה.' },
  { title: 'גילוי צרכים', hint: 'שאלות פתוחות, הקשבה, מיפוי כאב.' },
  { title: 'הצגת ערך', hint: 'התאמת הפתרון לצורך שעלה.' },
  { title: 'התמודדות עם התנגדויות', hint: 'מענה למחיר, זמן, אמון.' },
  { title: 'סגירה', hint: 'בקשת התחייבות, צעד הבא ברור.' },
];

export default function DealSalesScript() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-[12px] text-gray-500 leading-relaxed">
        אזור תסריט המכירה. בקרוב: תסריט דינמי, התנגדויות, נקודות דיבור,
        תזכורות והצעות חכמות — מותאם לדיל.
      </div>

      <ol className="space-y-2.5">
        {SECTIONS.map((s, i) => (
          <li
            key={s.title}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500">
                {i + 1}
              </span>
              <span className="text-[13px] font-semibold text-gray-800">{s.title}</span>
            </div>
            <p className="mt-1 ps-7 text-[12px] text-gray-400 leading-relaxed">{s.hint}</p>
          </li>
        ))}
      </ol>

      <button
        type="button"
        disabled
        title="בקרוב"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] font-medium text-gray-400 cursor-not-allowed"
      >
        ✎ ערוך תסריט (בקרוב)
      </button>
    </div>
  );
}
