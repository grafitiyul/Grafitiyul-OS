import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { formatMinor } from '../../../lib/money.js';
import {
  useTableColumns,
  ColumnPicker,
  SortableHeaderRow,
  TableCell,
} from '../../common/tableColumns.jsx';
import { ACTIVITY_STATUS_META, ROLE_LABELS } from './payrollConfig.js';
import PayrollActivityDrawer from './PayrollActivityDrawer.jsx';

// דוחות שכר — grouped by guide, over a year/month MULTI-select: one year,
// several years, specific months, whole years, cross-year comparisons — the
// client composes an explicit month list and the server aggregates. Full
// workspace width, shared table infra (chooser / drag / resize / persist).

const FILTERS_KEY = 'payroll.report.filters.v1';
const COLUMNS_KEY = 'payroll.report.columns.v1';

const MONTH_NAMES = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

const COLUMNS = [
  { key: 'date', label: 'תאריך', minWidth: 90 },
  { key: 'month', label: 'חודש שכר', minWidth: 80 },
  { key: 'activity', label: 'פעילות', minWidth: 160 },
  { key: 'kind', label: 'סוג', minWidth: 70 },
  { key: 'role', label: 'תפקיד', minWidth: 90 },
  { key: 'components', label: 'רכיבים', minWidth: 220 },
  { key: 'total', label: 'סה״כ', minWidth: 90 },
  { key: 'status', label: 'סטטוס', minWidth: 110 },
  { key: 'approvals', label: 'אישורים', minWidth: 130 },
];

function loadFilters() {
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY)) || {};
  } catch {
    return {};
  }
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[12px] border transition ${
        active
          ? 'bg-blue-600 border-blue-600 text-white'
          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

export default function PayrollReportPage() {
  const currentYear = new Date().getFullYear();
  const saved = loadFilters();
  const [years, setYears] = useState(() => (Array.isArray(saved.years) && saved.years.length ? saved.years : [currentYear]));
  const [months, setMonths] = useState(() => (Array.isArray(saved.months) ? saved.months : [new Date().getMonth() + 1]));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openActivityId, setOpenActivityId] = useState(null);

  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ years, months }));
  }, [years, months]);

  // Explicit month list: selected years × selected months (empty months set →
  // the whole year). This is what makes cross-year comparison trivial.
  const monthList = useMemo(() => {
    const mm = months.length ? months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return years.flatMap((y) => mm.map((m) => `${y}-${String(m).padStart(2, '0')}`)).sort();
  }, [years, months]);

  const load = useCallback(async () => {
    if (monthList.length === 0) {
      setData({ guides: [], summary: { officeApprovedMinor: 0, guideApprovedMinor: 0, waitingMinor: 0, draftMinor: 0 } });
      return;
    }
    setError(null);
    try {
      setData(await api.payroll.report(monthList));
    } catch (e) {
      setError(e.message);
      setData(null);
    }
  }, [monthList]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const { colKeys, toggleCol, moveCol, setColWidth, resetCols, widths, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  const yearOptions = useMemo(() => {
    const ys = new Set([currentYear - 2, currentYear - 1, currentYear, ...years]);
    return [...ys].sort();
  }, [currentYear, years]);

  const toggle = (list, setList, v) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b));

  const renderCell = (col, e) => {
    switch (col.key) {
      case 'date':
        return e.date ? e.date.split('-').reverse().join('/') : '—';
      case 'month':
        return e.payrollMonth;
      case 'activity':
        return e.activityTitle;
      case 'kind':
        return e.sourceType === 'tour_event' ? 'סיור' : 'כללית';
      case 'role':
        return e.role ? ROLE_LABELS[e.role] || e.role : '—';
      case 'components':
        return (
          <span className="text-[12px] text-gray-600">
            {e.lines.map((l, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 && ' · '}
                {l.name} {l.sign < 0 ? '−' : ''}{formatMinor(l.amountMinor)}
                {l.overridden && <span className="text-amber-600">✎</span>}
              </span>
            ))}
          </span>
        );
      case 'total':
        return <span className="font-semibold tabular-nums">{formatMinor(e.totals.totalMinor)}</span>;
      case 'status': {
        const meta = ACTIVITY_STATUS_META[e.status];
        return meta ? (
          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
        ) : null;
      }
      case 'approvals':
        return (
          <span className="text-[12px] text-gray-600">
            {e.status !== 'draft' ? `משרד ✓${e.officeApprovedBy ? ` (${e.officeApprovedBy})` : ''}` : 'משרד —'}
            {' · '}
            {e.guideStatus === 'approved' ? 'מדריך ✓' : e.guideStatus === 'inquiry' ? 'מדריך 💬' : 'מדריך —'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-white space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-base font-semibold text-gray-900">דוחות שכר</h1>
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-[12px]">
            <Link to="/admin/finance/payroll" className="px-2.5 py-1 text-gray-600 hover:bg-gray-50">
              יומי
            </Link>
            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-medium">דוחות</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] text-gray-500">שנים:</span>
            {yearOptions.map((y) => (
              <Chip key={y} active={years.includes(y)} onClick={() => toggle(years, setYears, y)}>
                {y}
              </Chip>
            ))}
          </div>
          <div className="flex-1" />
          <ColumnPicker columns={COLUMNS} colKeys={colKeys} onToggle={toggleCol} onMove={moveCol} onReset={resetCols} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] text-gray-500">חודשים:</span>
          <Chip active={months.length === 0} onClick={() => setMonths([])}>שנה שלמה</Chip>
          {MONTH_NAMES.map((name, i) => (
            <Chip key={i} active={months.includes(i + 1)} onClick={() => toggle(months, setMonths, i + 1)}>
              {name}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {error && <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
        {data === null ? (
          <div className="text-sm text-gray-400 p-6">טוען…</div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              {[
                ['סה״כ מאושר משרד', data.summary.officeApprovedMinor, 'text-gray-900'],
                ['מאושר ע״י מדריכים', data.summary.guideApprovedMinor, 'text-emerald-700'],
                ['ממתין לאישור מדריך', data.summary.waitingMinor, 'text-blue-700'],
                ['טיוטות (לא באישור משרד)', data.summary.draftMinor, 'text-amber-700'],
              ].map(([label, v, cls]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                  <div className="text-[11px] text-gray-500">{label}</div>
                  <div className={`text-[15px] font-bold tabular-nums ${cls}`}>{formatMinor(v)}</div>
                </div>
              ))}
            </div>

            {data.guides.length === 0 ? (
              <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">
                אין רשומות שכר בטווח שנבחר.
              </div>
            ) : (
              <div className="space-y-5">
                {data.guides.map((g) => (
                  <div key={g.externalPersonId} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{g.displayName}</span>
                      <span className="text-[12px] text-gray-500">{g.entries.length} רשומות</span>
                      <div className="flex-1" />
                      <span className="text-[12px] text-gray-600">
                        משרד: <b className="tabular-nums">{formatMinor(g.totals.officeApprovedMinor)}</b>
                        {' · '}מדריך אישר: <b className="tabular-nums text-emerald-700">{formatMinor(g.totals.guideApprovedMinor)}</b>
                        {g.totals.waitingMinor > 0 && (
                          <>
                            {' · '}ממתין: <b className="tabular-nums text-blue-700">{formatMinor(g.totals.waitingMinor)}</b>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-[13px]">
                        <thead>
                          <SortableHeaderRow
                            cols={visibleCols}
                            widths={widths}
                            onResize={setColWidth}
                            onMove={moveCol}
                            trClassName="border-b border-gray-200 text-[11px] text-gray-500"
                          />
                        </thead>
                        <tbody>
                          {g.entries.map((e) => (
                            <tr
                              key={e.id}
                              onClick={() => setOpenActivityId(e.activityId)}
                              className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer"
                            >
                              {orderedColumns.map((col) => (
                                <TableCell key={col.key} col={col} className="px-3 py-2">
                                  {renderCell(col, e)}
                                </TableCell>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
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
    </div>
  );
}
