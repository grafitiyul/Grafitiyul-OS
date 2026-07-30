import { useState } from 'react';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import QuestionnairePurposeCard from '../../settings/QuestionnairePurposeCard.jsx';
import CodeManagedNotifications from '../../adminReports/CodeManagedNotifications.jsx';

// Settings → Tours → "שיחת תיאום". Two tabs:
//   טפסים   — binds the coordination purpose to a questionnaire template
//             (unchanged behaviour; the builder still owns the form itself).
//   התראות  — the automatic guide notifications of the coordination-call flow
//             only (#11–#13). Same code-managed architecture as דיווחי מנהלים,
//             rendered by the SAME component — not a second notification screen.
//             The tour-summary reminders (#14–#16) live on their own workflow's
//             page: Settings → Tours → סיכום סיור → התראות אוטומטיות.
const TABS = [
  { key: 'forms', label: 'שאלוני שיחת תיאום' },
  { key: 'alerts', label: 'התראות אוטומטיות' },
];

const TAB_STORAGE_KEY = 'gos.coordinationSettings.tab';

export default function CoordinationSettingsPage() {
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">שיחת תיאום</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הטופס שהצוות ממלא לפני הסיור, וההתראות האוטומטיות שמזכירות למדריכים לבצע אותו.
        </p>
      </header>

      <div role="tablist" aria-label="הגדרות שיחת תיאום" className="mb-6 flex max-w-md gap-1 rounded-xl bg-gray-100 p-1">
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
          purpose="coordination"
          title="שאלון שיחת תיאום"
          description="הטופס הפנימי שממלאים אחרי שיחת התיאום עם הלקוח. נבנה בבילדר — כאן רק בוחרים איזו תבנית משמשת."
        />
      ) : (
        <CodeManagedNotifications
          group="coordination"
          emptyHe="עדיין אין התראות מדריכים מוגדרות."
        />
      )}
    </div>
  );
}
