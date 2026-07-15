import { useEffect, useState, useCallback } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { MIGRATION_TABS, tabForPath } from './config.js';
import { migrationApi } from './api.js';
import SnapshotCard from './components/SnapshotCard.jsx';
import ProgressSummary from './components/ProgressSummary.jsx';

// Migration Review Center — the TEMPORARY one-time tool for reviewing the
// Pipedrive/Airtable migration before it is imported into GOS.
//
// The header carries the state that matters on EVERY tab: the snapshot's real
// status and the review gate. The six tabs follow the approved information
// architecture.
export default function MigrationLayout() {
  const { pathname } = useLocation();
  const active = tabForPath(pathname);
  const [summary, setSummary] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, snap] = await Promise.all([migrationApi.summary(), migrationApi.snapshot()]);
      setSummary(s);
      setSnapshot(snap);
      setError(null);
    } catch (e) {
      setError(e?.status === 401 ? 'אין הרשאה' : 'טעינת מצב המיגרציה נכשלה');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const countFor = (key) => summary?.queues?.find((q) => q.key === key)?.counts?.unresolved ?? 0;

  return (
    <div className="h-full flex flex-col" dir="rtl">
      <div className="px-4 pt-4 pb-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-base font-semibold text-gray-900">בדיקת מיגרציה</h1>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">
            כלי זמני — יוסר בסיום המעבר
          </span>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SnapshotCard snapshot={snapshot} />
          <ProgressSummary summary={summary} />
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white overflow-x-auto">
        {MIGRATION_TABS.map((tab) => {
          const unresolved = countFor(tab.key);
          return (
            <Link
              key={tab.key}
              to={`/admin/migration/${tab.path}`}
              className={`px-3 py-1.5 text-[13px] rounded-md transition whitespace-nowrap flex items-center gap-1.5 ${
                active?.key === tab.key
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              {unresolved > 0 && (
                <span className="text-[11px] px-1.5 rounded-full bg-amber-100 text-amber-800 tabular-nums">
                  {unresolved.toLocaleString('he-IL')}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
        <Outlet context={{ summary, snapshot, reload: load }} />
      </div>
    </div>
  );
}
