import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor } from '../../lib/money.js';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell } from '../common/tableColumns.jsx';
import { COLLECTION_STATUS_LABELS, COLLECTION_STATUS_STYLES } from './collectionConfig.js';
import { dealPath } from '../deals/config.js';

// גבייה — the main Collection screen: every WON deal whose money has not fully
// arrived. Rows and all financial numbers come from the server Collection
// service (GET /api/collection/deals) — this page performs NO financial math.
// Table infrastructure (column chooser, drag-reorder, persistence) is the
// shared tableColumns kit used by Deals/Contacts.

const COLUMNS_KEY = 'collection.columns.v1';
const FILTERS_KEY = 'collection.filters.v1';

const dash = <span className="text-gray-400">—</span>;

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

function loadFilters() {
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY)) || {};
  } catch {
    return {};
  }
}
function saveFilters(f) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        COLLECTION_STATUS_STYLES[status] || 'bg-gray-100 text-gray-500'
      }`}
    >
      {COLLECTION_STATUS_LABELS[status] || status}
    </span>
  );
}

// Column config — `render` reads only server-provided fields; `sortVal` feeds
// the header click-to-sort. `owner` mirrors the Deals screen: disabled until a
// real User model exists (ownerUserId is a loose id we must not surface).
const COLUMNS = [
  { key: 'name', label: 'שם דיל', def: true, sortVal: (d) => d.title || '',
    render: (d) => <span className="font-semibold text-gray-900 text-[15px] group-hover:text-blue-700">{d.title}</span> },
  { key: 'organization', label: 'ארגון / לקוח', def: true,
    sortVal: (d) => d.organization?.name || d.primaryContactName || '',
    render: (d) =>
      d.organization?.name ? (
        <span>
          {d.organization.name}
          {d.organizationUnit?.name && (
            <span className="ms-1 text-[11px] text-gray-400">· {d.organizationUnit.name}</span>
          )}
        </span>
      ) : (
        d.primaryContactName || dash
      ),
    cls: 'text-gray-600' },
  { key: 'total', label: 'סך העסקה', def: true, dir: 'ltr',
    sortVal: (d) => d.totalMinor,
    cls: 'font-bold text-gray-900 text-[15px] tabular-nums',
    render: (d) => formatMinor(d.totalMinor, d.currency) },
  { key: 'paid', label: 'שולם', def: true, dir: 'ltr',
    sortVal: (d) => d.paidMinor,
    cls: 'tabular-nums text-emerald-700 font-medium',
    render: (d) => formatMinor(d.paidMinor, d.currency) },
  { key: 'balance', label: 'יתרה לגבייה', def: true, dir: 'ltr',
    sortVal: (d) => d.balanceMinor,
    cls: 'tabular-nums font-bold text-gray-900',
    render: (d) => formatMinor(d.balanceMinor, d.currency) },
  { key: 'paidPct', label: '% שולם', def: true, align: 'center',
    sortVal: (d) => d.paidPct ?? -1,
    render: (d) =>
      d.paidPct == null ? (
        dash
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100">
            <span
              className="block h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, Math.max(0, d.paidPct))}%` }}
            />
          </span>
          <span className="text-[12px] text-gray-600 tabular-nums" dir="ltr">{d.paidPct}%</span>
        </span>
      ) },
  { key: 'status', label: 'סטטוס גבייה', def: true, sortVal: (d) => d.status,
    render: (d) => <StatusChip status={d.status} /> },
  { key: 'tourDate', label: 'תאריך סיור', def: true, dir: 'ltr',
    sortVal: (d) => d.tourDate || '', cls: 'text-gray-500 tabular-nums',
    render: (d) => fmtDate(d.tourDate) },
  { key: 'lastPayment', label: 'תשלום אחרון', def: true, dir: 'ltr',
    sortVal: (d) => d.lastPaymentAt || '', cls: 'text-gray-500 tabular-nums',
    render: (d) => fmtDate(d.lastPaymentAt) },
  { key: 'wonAt', label: 'תאריך סגירה', def: false, dir: 'ltr',
    sortVal: (d) => d.wonAt || '', cls: 'text-gray-500 tabular-nums',
    render: (d) => fmtDate(d.wonAt) },
  { key: 'owner', label: 'אחראי', def: false, disabled: true, sortable: false,
    render: () => dash, cls: 'text-gray-600' },
];

const STATUS_FILTERS = [
  ['all', 'כל הסטטוסים'],
  ['unpaid', COLLECTION_STATUS_LABELS.unpaid],
  ['partial', COLLECTION_STATUS_LABELS.partial],
  ['no_amount', COLLECTION_STATUS_LABELS.no_amount],
];

export default function CollectionPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [saved] = useState(loadFilters);
  const [search, setSearch] = useState(saved.search ?? '');
  const [status, setStatus] = useState(saved.status ?? 'all');
  // Default sort: the biggest outstanding balance first — that's the work.
  const [sort, setSort] = useState({ key: 'balance', dir: 'desc' });

  useEffect(() => {
    saveFilters({ search, status });
  }, [search, status]);

  const { colKeys, toggleCol, moveCol, setColWidth, widths, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { deals } = await api.collection.deals();
        if (!cancelled) setRows(deals);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const s = { count: rows.length, balance: 0, unpaid: 0, partial: 0 };
    for (const r of rows) {
      s.balance += Math.max(0, Number(r.balanceMinor || 0));
      if (r.status === 'unpaid') s.unpaid++;
      if (r.status === 'partial') s.partial++;
    }
    return s;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (q) {
        const hay = [r.title, r.organization?.name, r.organizationUnit?.name, r.primaryContactName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (col?.sortVal) {
      const mul = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const va = col.sortVal(a);
        const vb = col.sortVal(b);
        if (va < vb) return -1 * mul;
        if (va > vb) return 1 * mul;
        return 0;
      });
    }
    return out;
  }, [rows, search, status, sort]);

  function onSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  }

  return (
    <div className="mx-auto max-w-[1600px] px-5 lg:px-8 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white text-lg shadow-sm">
            💰
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 leading-tight">גבייה</h1>
            <p className="text-[12px] text-gray-500">עסקאות WON שטרם נגבו במלואן</p>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <SummaryCard label="יתרה לגבייה" value={formatMinor(summary.balance, 'ILS')} tone="emerald" icon="💰" />
        <SummaryCard label="טרם שולם" value={summary.unpaid} tone="red" icon="⏳" />
        <SummaryCard label="שולם חלקית" value={summary.partial} tone="amber" icon="◐" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 mb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-[2] min-w-[260px]">
            <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם דיל, ארגון או איש קשר…"
              className="h-11 w-full rounded-lg border border-gray-300 bg-gray-50/60 pr-10 pl-3 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 min-w-[9rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          >
            {STATUS_FILTERS.map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
          </select>
          <div className="ms-auto">
            <ColumnPicker columns={orderedColumns} colKeys={colKeys} onToggle={toggleCol} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-red-600">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center max-w-sm mx-auto">
            <div className="text-5xl mb-4 opacity-70">💰</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">אין עסקאות לגבייה</h3>
            <p className="text-sm text-gray-500 leading-relaxed">כל עסקאות ה-WON נגבו במלואן. 🎉</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">לא נמצאו עסקאות תואמות.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <SortableHeaderRow
                  cols={visibleCols}
                  onMove={moveCol}
                  sort={sort}
                  onSort={onSort}
                  widths={widths}
                  onResize={setColWidth}
                  trClassName="text-gray-500 bg-gray-50/70 border-b border-gray-100"
                >
                  <th className="w-10 border-s border-gray-100/70" />
                </SortableHeaderRow>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((d) => (
                  <tr
                    key={d.id}
                    className="group hover:bg-blue-50/40 cursor-pointer transition-colors"
                    onClick={() => navigate(dealPath(d))}
                  >
                    {visibleCols.map((c) => (
                      <TableCell key={c.key} col={c}>{c.render(d)}</TableCell>
                    ))}
                    <td className="px-4 py-3 align-middle border-s border-gray-100/70" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => navigate(dealPath(d))}
                        title="פתח דיל"
                        className="h-8 w-8 rounded-md text-gray-400 hover:text-blue-700 hover:bg-blue-50"
                      >
                        ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const SUMMARY_TONES = {
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  red: 'bg-red-50 text-red-600 ring-red-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
};
const SUMMARY_TEXT = {
  emerald: 'text-emerald-700',
  red: 'text-red-700',
  amber: 'text-amber-700',
};

function SummaryCard({ label, value, tone, icon }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-right shadow-sm">
      <div className="min-w-0">
        <div className={`text-[10px] font-semibold tracking-wide ${SUMMARY_TEXT[tone]}`}>{label}</div>
        <div className="text-lg font-bold leading-tight text-gray-900 tabular-nums" dir="ltr">{value}</div>
      </div>
      <span className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-sm ring-1 ${SUMMARY_TONES[tone]}`}>
        {icon}
      </span>
    </div>
  );
}
