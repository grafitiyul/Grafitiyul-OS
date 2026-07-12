import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { formatMinor } from '../../../lib/money.js';
import { DateField, fmtDate } from '../../common/pickers/DateTimeFields.jsx';
import { ACTIVITY_STATUS_META } from './payrollConfig.js';
import PayrollActivityDrawer from './PayrollActivityDrawer.jsx';
import AddGeneralActivityDialog from './AddGeneralActivityDialog.jsx';

// שכר צוות — the main payroll screen. The workflow starts from ACTIVITIES:
// pick a day, see that day's activities with their payroll status, click one
// to open the drawer (staff columns × component rows). Full workspace width —
// no centered layout. All numbers are server-computed.

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDay(dateISO, days) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function StatusChip({ statusKey }) {
  const meta = ACTIVITY_STATUS_META[statusKey];
  if (!meta) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export default function PayrollDayPage() {
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState(null);
  const [monthRows, setMonthRows] = useState([]);
  const [error, setError] = useState(null);
  const [openActivityId, setOpenActivityId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { activities, monthActivities } = await api.payroll.day(date);
      setRows(activities);
      setMonthRows(monthActivities || []);
    } catch (e) {
      setError(e.message);
      setRows([]);
      setMonthRows([]);
    }
  }, [date]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-wrap">
        <h1 className="text-base font-semibold text-gray-900">שכר צוות</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDate((d) => shiftDay(d, 1))}
            className="px-2 py-1 text-sm rounded hover:bg-gray-100 text-gray-500"
            title="יום קדימה"
          >
            ›
          </button>
          <div className="w-44">
            <DateField value={date} onChange={(v) => v && setDate(v)} />
          </div>
          <button
            type="button"
            onClick={() => setDate((d) => shiftDay(d, -1))}
            className="px-2 py-1 text-sm rounded hover:bg-gray-100 text-gray-500"
            title="יום אחורה"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setDate(todayISO())}
            className="px-2 py-1 text-[12px] rounded text-blue-600 hover:bg-blue-50"
          >
            היום
          </button>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="px-3 py-1.5 text-[13px] rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          + פעילות כללית
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>
        )}
        {rows === null ? (
          <div className="text-sm text-gray-400 p-6">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">
            אין פעילויות שכר בתאריך {fmtDate(date)} — סיורים מופיעים כאן לאחר שהושלמו.
          </div>
        ) : (
          <ActivityList rows={rows} onOpen={setOpenActivityId} />
        )}

        {monthRows.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[13px] font-medium text-gray-500 mb-2">
              פעילויות החודש ללא תאריך ({date.slice(0, 7)})
            </h2>
            <ActivityList rows={monthRows} onOpen={setOpenActivityId} />
          </div>
        )}
      </div>

      {openActivityId && (
        <PayrollActivityDrawer
          activityId={openActivityId}
          onClose={() => {
            setOpenActivityId(null);
            load();
          }}
        />
      )}
      {addOpen && (
        <AddGeneralActivityDialog
          defaultDate={date}
          onClose={() => setAddOpen(false)}
          onCreated={(activityId) => {
            setAddOpen(false);
            load();
            setOpenActivityId(activityId);
          }}
        />
      )}
    </div>
  );
}

function ActivityList({ rows, onOpen }) {
  if (!rows.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
      {rows.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpen(a.id)}
          className="w-full flex items-center gap-4 px-4 py-3 text-right hover:bg-gray-50 transition"
        >
          <span className="text-[13px] text-gray-500 w-12 shrink-0 tabular-nums">
            {a.startTime || '—'}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-gray-900 truncate">{a.titleHe}</span>
            <span className="block text-[12px] text-gray-500">
              {a.sourceType === 'tour_event' ? 'סיור' : 'פעילות כללית'} · {a.entryCount} אנשי צוות
            </span>
          </span>
          <span className="text-sm text-gray-700 tabular-nums shrink-0">
            {a.entryCount > 0 ? formatMinor(a.officeTotalMinor) : ''}
          </span>
          <StatusChip statusKey={a.displayStatus} />
        </button>
      ))}
    </div>
  );
}
