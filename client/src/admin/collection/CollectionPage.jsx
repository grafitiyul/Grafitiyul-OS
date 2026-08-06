import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor } from '../../lib/money.js';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell } from '../common/tableColumns.jsx';
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_STYLES,
  COLLECTION_REVIEW_STATUS_LABELS,
  COLLECTION_REVIEW_STATUS_STYLES,
  PAYMENT_REVIEW_STATUS_LABELS,
  PAYMENT_REVIEW_STATUS_STYLES,
} from './collectionConfig.js';
import AdvancedFilterButton from '../common/filters/AdvancedFilterButton.jsx';
import { evaluateTree, normalizeTree, emptyGroup } from '../common/filters/advancedFilterCore.js';
import { COLLECTION_FILTER_FIELDS, COLLECTION_FILTER_FIELDS_BY_KEY } from './collectionFilterFields.js';
import { summarizeCollectionRows } from './collectionSummary.js';
import { dealPath } from '../deals/config.js';
import { useListState, useListScrollRestore, useListOrigin } from '../common/useListState.js';

// גבייה — the main Collection screen: every WON deal whose money has not fully
// arrived. Rows and all financial numbers come from the server Collection
// service (GET /api/collection/deals) — this page performs NO financial math.
// Table infrastructure (column chooser, drag-reorder, persistence) is the
// shared tableColumns kit used by Deals/Contacts.

const COLUMNS_KEY = 'collection.columns.v1';
const FILTERS_KEY = 'collection.filters.v1';

// Durable list state (listState.js). The advanced filter TREE is deliberately
// `url: false` — serialising a whole boolean tree into the query string would
// produce unreadable, unshareable links; it keeps its existing per-browser
// persistence below while queue/status/search/sort become URL-owned.
const LIST_FIELDS = {
  q: { default: '', sticky: true },
  status: { default: 'all', sticky: true },
  queue: { default: 'active_collection', sticky: true },
  sort: { type: 'sort', default: { key: 'balance', dir: 'desc' }, sticky: true },
};

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

// The operational badge. Shown wherever collection status is shown, so a
// historical deal is never mistaken for outstanding work.
export function ReviewStatusBadge({ status, className = '' }) {
  if (!status) return null;
  return (
    <span
      title={status === 'likely_paid_legacy'
        ? 'עסקה היסטורית שיובאה מהמערכת הקודמת — ההנחה העסקית היא שהיא כבר שולמה שם. היתרה החשבונאית מוצגת כפי שהיא.'
        : 'עסקה שדורשת טיפול גבייה'}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${
        COLLECTION_REVIEW_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600 ring-gray-200'
      } ${className}`}
    >
      {COLLECTION_REVIEW_STATUS_LABELS[status] || status}
    </span>
  );
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
  { key: 'reviewStatus', label: 'טיפול בגבייה', def: false,
    sortVal: (d) => d.collectionReviewStatus || '',
    render: (d) => <ReviewStatusBadge status={d.collectionReviewStatus} /> },
  { key: 'paymentReview', label: 'בדיקת מקדמה', def: false,
    sortVal: (d) => d.paymentReviewStatus || '',
    render: (d) =>
      d.paymentReviewStatus ? (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${
            PAYMENT_REVIEW_STATUS_STYLES[d.paymentReviewStatus] || 'bg-gray-100 text-gray-600 ring-gray-200'
          }`}
        >
          {PAYMENT_REVIEW_STATUS_LABELS[d.paymentReviewStatus] || d.paymentReviewStatus}
        </span>
      ) : (
        dash
      ) },
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
  ['overpaid', COLLECTION_STATUS_LABELS.overpaid],
  ['review', COLLECTION_STATUS_LABELS.review],
];

export default function CollectionPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [saved] = useState(loadFilters);
  // Search / status / queue / sort live in the URL (see LIST_FIELDS): opening a
  // deal from here and coming back restores the exact working view.
  // Default sort: the biggest outstanding balance first — that's the work.
  // Default queue: only deals someone should be chasing; the historical
  // population stays one click away, never silently gone.
  const list = useListState({ key: 'collection', fields: LIST_FIELDS });
  const { q: search, status, queue, sort } = list;
  const origin = useListOrigin();
  const [counts, setCounts] = useState({});
  // Deals in this queue that are already fully collected, and so are not work.
  const [settledHidden, setSettledHidden] = useState(0);
  const [advanced, setAdvanced] = useState(() => normalizeTree(saved.advanced) || emptyGroup());

  useEffect(() => {
    saveFilters({ advanced });
  }, [advanced]);

  const { colKeys, toggleCol, moveCol, setColWidth, widths, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.collection.deals({ reviewStatus: queue });
        if (!cancelled) {
          setRows(res.deals || []);
          setCounts(res.counts || {});
          setSettledHidden(res.settledHidden || 0);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queue]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      // The SHARED advanced-filter engine — same component and evaluator the
      // Tours screen uses, over the rows already loaded.
      if (!evaluateTree(advanced, r, COLLECTION_FILTER_FIELDS_BY_KEY)) return false;
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
  }, [rows, search, status, sort, advanced]);

  // ONE derivation for the header cards, over the SAME rows the table renders.
  // Buckets are total by construction (collectionSummary.js), so the cards can
  // never again sum to less than the visible rows.
  const summary = useMemo(() => summarizeCollectionRows(filtered), [filtered]);

  function onSort(key) {
    list.set({
      sort: sort.key === key ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    });
  }

  const scrollAnchor = useListScrollRestore(!loading);

  return (
    <div ref={scrollAnchor} className="mx-auto max-w-[1600px] px-5 lg:px-8 py-4">
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
        <button type="button" onClick={() => navigate('/admin/finance/collection/review')}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
          התאמות לבדיקה →
        </button>
      </div>

      {/* Summary strip — one card per status PRESENT in the rendered rows,
          derived by the shared summarizer. Never a hardcoded subset again. */}
      <div className="flex flex-wrap gap-2 mb-3">
        <SummaryCard label="יתרה לגבייה" value={formatMinor(summary.balanceMinor, 'ILS')} tone="emerald" icon="💰" />
        {summary.buckets.map((b) => (
          <SummaryCard
            key={b.status}
            label={COLLECTION_STATUS_LABELS[b.status] || b.status}
            value={b.count}
            tone={STATUS_TONE[b.status] || 'gray'}
            icon={STATUS_ICON[b.status] || '❔'}
          />
        ))}
      </div>

      {/* THE work queue switch. The default view is the actionable queue; the
          historical population is one click away and its size is always shown,
          so nothing is hidden without saying so. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {[
          ['active_collection', 'בגבייה פעילה'],
          ['likely_paid_legacy', 'ככל הנראה שולם במערכת קודמת'],
          ['all', 'הכול'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => list.set({ queue: k })}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              queue === k ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {label}
            {counts[k] != null && <span className="ms-1.5 opacity-70">({counts[k]})</span>}
            {k === 'all' && counts.active_collection != null && counts.likely_paid_legacy != null && (
              <span className="ms-1.5 opacity-70">({counts.active_collection + counts.likely_paid_legacy})</span>
            )}
          </button>
        ))}
        {settledHidden > 0 && (
          <span className='text-[12px] text-gray-500'>
            {settledHidden} עסקאות בתור הזה כבר נגבו במלואן ואינן מוצגות.
          </span>
        )}
        {queue === 'likely_paid_legacy' && (
          <span className="text-[12px] text-gray-500">
            עסקאות היסטוריות שיובאו מהמערכת הקודמת — ההנחה העסקית היא שכבר שולמו. היתרות מוצגות כפי שהן.
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 mb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-[2] min-w-[260px]">
            <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">🔍</span>
            <input
              value={search}
              onChange={(e) => list.set({ q: e.target.value })}
              placeholder="חיפוש לפי שם דיל, ארגון או איש קשר…"
              className="h-11 w-full rounded-lg border border-gray-300 bg-gray-50/60 pr-10 pl-3 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
          <select
            value={status}
            onChange={(e) => list.set({ status: e.target.value })}
            className="h-10 min-w-[9rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          >
            {STATUS_FILTERS.map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
          </select>
          <AdvancedFilterButton
            fields={COLLECTION_FILTER_FIELDS}
            fieldsByKey={COLLECTION_FILTER_FIELDS_BY_KEY}
            tree={advanced}
            onChange={setAdvanced}
            rows={rows}
          />
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
                    onClick={() => navigate(dealPath(d), { state: origin })}
                  >
                    {visibleCols.map((c) => (
                      <TableCell key={c.key} col={c}>{c.render(d)}</TableCell>
                    ))}
                    <td className="px-4 py-3 align-middle border-s border-gray-100/70" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => navigate(dealPath(d), { state: origin })}
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
  purple: 'bg-purple-50 text-purple-600 ring-purple-100',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  gray: 'bg-gray-100 text-gray-500 ring-gray-200',
};
const SUMMARY_TEXT = {
  emerald: 'text-emerald-700',
  red: 'text-red-700',
  amber: 'text-amber-700',
  purple: 'text-purple-700',
  sky: 'text-sky-700',
  gray: 'text-gray-600',
};

// Presentation per canonical status. A status missing here still renders (gray)
// — these maps style buckets, they never decide membership.
const STATUS_TONE = {
  unpaid: 'red',
  partial: 'amber',
  review: 'purple',
  no_amount: 'gray',
  overpaid: 'sky',
  paid: 'emerald',
};
const STATUS_ICON = {
  unpaid: '⏳',
  partial: '◐',
  review: '⚑',
  no_amount: '✏️',
  overpaid: '⇅',
  paid: '✓',
};

function SummaryCard({ label, value, tone, icon }) {
  return (
    <div className="flex min-w-[170px] flex-1 items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-right shadow-sm sm:flex-none sm:min-w-[190px]">
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
