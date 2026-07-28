import { useState } from 'react';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import AdminReportDeliveries from './AdminReportDeliveries.jsx';
import CodeManagedNotifications from './CodeManagedNotifications.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// "דיווחי מנהלים" — the OFFICE-facing code-managed notifications.
//
// The card list itself lives in CodeManagedNotifications (shared with the Tour
// Settings notifications tab) so there is exactly one implementation of the
// "code-managed notification" surface. This page owns only the screen chrome
// and the module-wide delivery log.
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const [logOpen, setLogOpen] = useState(false);

  return (
    <div dir="rtl" className="mx-auto max-w-[1400px] px-5 pb-16 lg:px-8">
      <SettingsChrome />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-xl text-white shadow-sm">📣</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-gray-900">דיווחי מנהלים</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            התראות פנימיות אוטומטיות המנוהלות בקוד. לכל דיווח מספר קבוע — אפשר לבקש שינוי לפי המספר.
            התראות למדריכים מוגדרות בהגדרות הסיורים, תחת «שיחת תיאום».
          </p>
        </div>
        <button type="button" onClick={() => setLogOpen(true)}
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
          יומן שליחות
        </button>
      </div>

      <CodeManagedNotifications group="office" />

      {logOpen && <AdminReportDeliveries report={null} onClose={() => setLogOpen(false)} />}
    </div>
  );
}
