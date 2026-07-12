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
import MultiSelectFilter, { isUnrestricted } from '../../common/filters/MultiSelectFilter.jsx';
import { ACTIVITY_STATUS_META, ROLE_LABELS } from './payrollConfig.js';
import PayrollActivityDrawer from './PayrollActivityDrawer.jsx';

// דוחות שכר — ONE symmetric full-width working table over all entries in the
// selected range. Filters are the shared MultiSelectFilter (years, months,
// guides — intersection, server-computed totals under any selection).
// Column layout rides the shared tableColumns infra (chooser/drag/resize/
// persist). All money server-computed and rendered LTR.

const FILTERS_KEY = 'payroll.report.filters.v2';
const COLUMNS_KEY = 'payroll.report.columns.v2';

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const COLUMNS = [
  { key: 'date', label: 'תאריך', minWidth: 84 },
  { key: 'month', label: 'חודש שכר', minWidth: 76 },
  { key: 'guide', label: 'מדריך', minWidth: 110 },
  { key: 'activity', label: 'פעילות', minWidth: 150 },
  { key: 'kind', label: 'סוג', minWidth: 60 },
  { key: 'role', label: 'תפקיד', minWidth: 88 },
  { key: 'components', label: 'רכיבים', minWidth: 200 },
  { key: 'officeAmount', label: 'אושר משרד', minWidth: 92 },
  { key: 'guideAmount', label: 'אושר מדריך', minWidth: 92 },
  { key: 'status', label: 'סטטוס', minWidth: 104 },
];

function loadFilters() {
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY)) || {};
  } catch {
    return {};
  }
}

function Money({ minor }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {formatMinor(minor)}
    </span>
  );
}

export default function PayrollReportPage() {
  const currentYear = new Date().getFullYear();
  const saved = loadFilters();
  const [years, setYears] = useState(() => (Array.isArray(saved.years) ? saved.years : [currentYear]));
  const [months, setMonths] = useState(() => (Array.isArray(saved.months) ? saved.months : []));
  const [guides, setGuides] = useState(() => (Array.isArray(saved.guides) ? saved.guides : []));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openActivityId, setOpenActivityId] = useState(null);

  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ years, months, guides }));
  }, [years, months, guides]);

  const yearOptions = useMemo(() => {
    const ys = new Set([2025, currentYear - 1, currentYear, ...years]);
    return [...ys].sort().map((y) => ({ value: y, label: String(y) }));
  }, [currentYear, years]);
  const monthOptions = useMemo(
    () => MONTH_NAMES.map((label, i) => ({ value: i + 1, label })),
    [],
  );
  const guideOptions = data?.guideOptions || [];

  // Explicit month list: (selected|all) years × (selected|all) months — the
  // intersection semantics that make cross-year comparison trivial.
  const monthList = useMemo(() => {
    const ys = isUnrestricted(years, yearOptions) ? yearOptions.map((o) => o.value) : years;
    const ms = isUnrestricted(months, monthOptions) ? monthOptions.map((o) => o.value) : months;
    return ys.flatMap((y) => ms.map((m) => `${y}-${String(m).padStart(2, '0')}`)).sort();
  }, [years, months, yearOptions, monthOptions]);

  const guideParam = useMemo(
    () => (guideOptions.length && !isUnrestricted(guides, guideOptions) ? guides : []),
    [guides, guideOptions],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.payroll.report(monthList, guideParam));
    } catch (e) {
      setError(e.message);
      setData(null);
    }
  }, [monthList, guideParam]);

  useEffect(() => {
    load();
  }, [load]);

  const { colKeys, toggleCol, moveCol, setColWidth, resetCols, widths, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  // One flat row set — the symmetric table (guide is a column, not a card).
  const rows = useMemo(() => {
    if (!data) return [];
    return data.guides.flatMap((g) =>
      g.entries.map((e) => ({ ...e, guideName: g.displayName })),
    );
  }, [data]);

  const renderCell = (col, e) => {
    switch (col.key) {
      case 'date':
        return e.date ? e.date.split('-').reverse().join('/') : '—';
      case 'month':
        return e.payrollMonth;
      case 'guide':
        return <span className="font-medium text-gray-900">{e.guideName}</span>;
      case 'activity':
        return e.activityTitle;
      case 'kind':
        return e.sourceType === 'tour_event' ? 'סיור' : 'כללית';
      case 'role':
        return e.role ? ROLE_LABELS[e.role] || e.role : '—';
      case 'components':
        return (
          <span className="text-[12px] text-gray-500">
            {e.lines.map((l, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 && ' · '}
                {l.name} <Money minor={l.amountMinor * (l.sign < 0 ? -1 : 1)} />
                {l.overridden && <span className="text-amber-600">✎</span>}
              </span>
            ))}
          </span>
        );
      case 'officeAmount':
        return e.status !== 'draft' ? <Money minor={e.totals.totalMinor} /> : <span className="text-gray-300">—</span>;
      case 'guideAmount':
        return e.guideStatus === 'approved' ? (
          <Money minor={e.totals.totalMinor} />
        ) : (
          <span className="text-gray-300">—</span>
        );
      case 'status': {
        const meta = ACTIVITY_STATUS_META[e.status];
        return meta ? (
          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
        ) : null;
      }
      default:
        return null;
    }
  };

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white flex-wrap">
        <h1 className="text-base font-semibold text-gray-900">דוחות שכר</h1>
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-[12px]">
          <Link to="/admin/finance/payroll" className="px-2.5 py-1 text-gray-600 hover:bg-gray-50">
            יומי
          </Link>
          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-medium">דוחות</span>
        </div>
        <MultiSelectFilter
          label="שנים"
          options={yearOptions}
          values={years}
          onChange={setYears}
          allLabel="כל השנים"
          noun={{ one: 'שנה', many: 'שנים' }}
          width={180}
        />
        <MultiSelectFilter
          label="חודשים"
          options={monthOptions}
          values={months}
          onChange={setMonths}
          allLabel="כל החודשים"
          noun={{ one: 'חודש', many: 'חודשים' }}
          width={200}
        />
        <MultiSelectFilter
          label="מדריכים"
          options={guideOptions}
          values={guides}
          onChange={setGuides}
          allLabel="כל המדריכים"
          noun={{ one: 'מדריך', many: 'מדריכים' }}
          searchable
          width={260}
        />
        <div className="flex-1" />
        <ColumnPicker columns={COLUMNS} colKeys={colKeys} onToggle={toggleCol} onMove={moveCol} onReset={resetCols} />
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
                ['מתוכו בבירור', data.summary.inquiryMinor, 'text-orange-700'],
                ['טיוטות', data.summary.draftMinor, 'text-amber-700'],
              ].map(([label, v, cls]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-2">
                  <div className="text-[11px] text-gray-500">{label}</div>
                  <div className={`text-[15px] font-bold ${cls}`}>
                    <Money minor={v} />
                  </div>
                </div>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">
                אין רשומות שכר בטווח שנבחר.
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-right text-[13px]">
                  <thead>
                    <SortableHeaderRow
                      cols={visibleCols}
                      widths={widths}
                      onResize={setColWidth}
                      onMove={moveCol}
                      trClassName="border-b border-gray-200 text-[11px] text-gray-500 bg-gray-50"
                    />
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr
                        key={e.id}
                        onClick={() => setOpenActivityId(e.activityId)}
                        className="h-11 border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer align-middle"
                      >
                        {orderedColumns.map((col) => (
                          <TableCell key={col.key} col={col} className="px-3 py-0">
                            {renderCell(col, e)}
                          </TableCell>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
