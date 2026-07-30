import { useState } from 'react';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import QuestionnairePurposeCard from '../../settings/QuestionnairePurposeCard.jsx';
import CodeManagedNotifications from '../../adminReports/CodeManagedNotifications.jsx';

// Settings → Tours → "סיכום סיור". Two tabs:
//   שאלון   — binds the tour-summary purpose to a questionnaire template
//             (unchanged behaviour; the builder still owns the form itself).
//   התראות  — the automatic guide notifications of the summary flow (#14–#16).
//             Same code-managed architecture as דיווחי מנהלים, rendered by the
//             SAME component — not a second notification screen. Each workflow
//             owns only its own notifications: coordination reminders live on
//             the שיחת תיאום page.
const TABS = [
  { key: 'forms', label: 'שאלון סיכום סיור' },
  { key: 'alerts', label: 'התראות אוטומטיות' },
];

const TAB_STORAGE_KEY = 'gos.tourSummarySettings.tab';

export default function TourSummarySettingsPage() {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      return TABS.some((t) => t.key === saved) ? saved : 'forms';
    } catch { return 'forms'; }
  });

  function selectTab(key) {
    setTab(key);
    try { localStorage.setItem(TAB_STORAGE_KEY, key); } catch { /* private mode */ }
  }

  const wide = tab === 'alerts';

  return (
    <div dir="rtl" className={`px-5 py-8 lg:px-10 lg:py-10 mx-auto ${wide ? 'max-w-[1400px]' : 'max-w-3xl'}`}>
      <header className="mb-6">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סיכום סיור</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          השאלון שצוות הסיור ממלא בסיום כל סיור, וההתראות האוטומטיות שמזכירות למדריכים למלא אותו.
        </p>
      </header>

      <div role="tablist" aria-label="הגדרות סיכום סיור" className="mb-6 flex max-w-md gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'forms' ? (
        <QuestionnairePurposeCard
          purpose="tour_summary"
          title="שאלון סיכום סיור"
          description="השאלון שצוות הסיור ממלא בסיום כל סיור. נבנה בבילדר השאלונים — כאן רק בוחרים איזו תבנית משמשת."
        />
      ) : (
        <CodeManagedNotifications
          group="tour_summary"
          emptyHe="עדיין אין התראות סיכום סיור מוגדרות."
        />
      )}
    </div>
  );
}
