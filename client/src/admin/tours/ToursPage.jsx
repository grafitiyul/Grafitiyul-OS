import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell } from '../common/tableColumns.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import TourSlotModal from './TourSlotModal.jsx';
import {
  TOUR_KIND_LABELS,
  TOUR_KIND_STYLES,
  TOUR_STATUS_LABELS,
  TOUR_STATUS_STYLES,
  TOUR_LANG_LABELS,
  STATUS_FILTER_OPTIONS,
  statusFilterMatches,
  fmtTourDate,
} from './config.js';

// "סיורים" — the operational Tours module main screen. Table of TourEvents on
// the shared premium-table kit (chooser/drag/resize/persistence — same infra
// as Deals/Collection). Group Tour Slots are created and edited here;
// private/business tours arrive automatically from WON deals and their
// planning fields are edited on the DEAL (this screen only operates them).
// The calendar tab is an approved placeholder — views come later.

const COLUMNS_KEY = 'tours.columns.v1';
const FILTERS_KEY = 'tours.filters.v1';

const dash = <span className="text-gray-400">—</span>;

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

function Chip({ styles, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles}`}>
      {label}
    </span>
  );
}

// Occupancy for group slots: "12 / 30" (amber at full, red when overbooked —
// warnings only, never a hard limit). Private/business: the seat count.
function Occupancy({ t }) {
  if (t.kind !== 'group_slot') {
    return <span className="tabular-nums">{t.activeSeats || dash}</span>;
  }
  const over = t.capacity != null && t.activeSeats > t.capacity;
  const full = t.capacity != null && !over && t.activeSeats === t.capacity;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums" dir="ltr">
      <span className={over ? 'font-bold text-red-600' : full ? 'font-bold text-amber-600' : 'font-medium text-gray-800'}>
        {t.activeSeats}
      </span>
      <span className="text-gray-400">/ {t.capacity ?? '—'}</span>
      {t.activeBookings > 0 && (
        <span className="text-[11px] text-gray-400">· {t.activeBookings} דילים</span>
      )}
      {over && <span className="text-[11px] font-semibold text-red-600">חריגה</span>}
    </span>
  );
}

const COLUMNS = [
  { key: 'date', label: 'תאריך', def: true, sortVal: (t) => `${t.date} ${t.startTime}`,
    cls: 'font-semibold text-gray-900',
    render: (t) => fmtTourDate(t.date) },
  { key: 'startTime', label: 'שעה', def: true, dir: 'ltr', sortVal: (t) => t.startTime,
    cls: 'tabular-nums text-gray-700', render: (t) => t.startTime },
  { key: 'kind', label: 'סוג', def: true, sortVal: (t) => t.kind,
    render: (t) => <Chip styles={TOUR_KIND_STYLES[t.kind]} label={TOUR_KIND_LABELS[t.kind] || t.kind} /> },
  { key: 'product', label: 'מוצר', def: true, sortVal: (t) => t.product?.nameHe || '',
    cls: 'text-gray-800 font-medium',
    render: (t) => t.product?.nameHe || dash },
  { key: 'location', label: 'עיר', def: true,
    sortVal: (t) => t.location?.nameHe || t.productVariant?.location?.nameHe || '',
    cls: 'text-gray-600',
    render: (t) => t.location?.nameHe || t.productVariant?.location?.nameHe || dash },
  { key: 'language', label: 'שפה', def: true, sortVal: (t) => t.tourLanguage || '',
    cls: 'text-gray-600',
    render: (t) => TOUR_LANG_LABELS[t.tourLanguage] || dash },
  { key: 'occupancy', label: 'משתתפים', def: true, sortVal: (t) => t.activeSeats,
    render: (t) => <Occupancy t={t} /> },
  { key: 'status', label: 'סטטוס', def: true, sortVal: (t) => t.status,
    render: (t) => <Chip styles={TOUR_STATUS_STYLES[t.status]} label={TOUR_STATUS_LABELS[t.status] || t.status} /> },
  { key: 'notes', label: 'הערות', def: false, sortable: false,
    cls: 'text-gray-500 max-w-[280px] truncate',
    render: (t) => t.notes || dash },
  { key: 'createdAt', label: 'נוצר', def: false, dir: 'ltr',
    sortVal: (t) => t.createdAt || '',
    cls: 'text-gray-500 tabular-nums',
    render: (t) => (t.createdAt ? new Date(t.createdAt).toLocaleDateString('he-IL') : dash) },
];

const KIND_FILTERS = [
  ['all', 'כל הסוגים'],
  ['group_slot', TOUR_KIND_LABELS.group_slot],
  ['private', TOUR_KIND_LABELS.private],
  ['business', TOUR_KIND_LABELS.business],
];

const STATUS_FILTERS = STATUS_FILTER_OPTIONS;

export default function ToursPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('table');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [saved] = useState(loadFilters);
  const [search, setSearch] = useState(saved.search ?? '');
  const [kind, setKind] = useState(saved.kind ?? 'all');
  const [status, setStatus] = useState(saved.status ?? 'active');
  // Upcoming first — the operational default.
  const [sort, setSort] = useState({ key: 'date', dir: 'asc' });

  const [modalOpen, setModalOpen] = useState(false);
  const [editTour, setEditTour] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'cancel'|'delete'|'restore', tour }

  useEffect(() => {
    saveFilters({ search, kind, status });
  }, [search, kind, status]);

  const { colKeys, toggleCol, moveCol, setColWidth, widths, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  async function refresh() {
    try {
      const tours = await api.tours.list();
      setRows(tours);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((t) => {
      if (kind !== 'all' && t.kind !== kind) return false;
      if (!statusFilterMatches(status, t.status)) return false;
      if (q) {
        const hay = [
          t.product?.nameHe,
          t.product?.nameEn,
          t.location?.nameHe,
          t.productVariant?.location?.nameHe,
          t.notes,
          t.date,
        ]
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
  }, [rows, search, kind, status, sort]);

  function onSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'asc' }));
  }

  function openCreate() {
    setEditTour(null);
    setModalOpen(true);
  }

  function openEdit(t) {
    // Group slots are edited here; private/business planning lives on the Deal.
    if (t.kind !== 'group_slot') return;
    setEditTour(t);
    setModalOpen(true);
  }

  async function runConfirmAction() {
    const { type, tour } = confirmAction;
    try {
      if (type === 'delete') await api.tours.remove(tour.id);
      else if (type === 'cancel') await api.tours.update(tour.id, { status: 'cancelled' });
      else if (type === 'restore') await api.tours.update(tour.id, { status: 'scheduled' });
      await refresh();
    } catch (e) {
      const code = e.payload?.error;
      alert(
        code === 'tour_has_active_bookings'
          ? 'לא ניתן לבטל סיור עם דילים פעילים — יש להסיר או להעביר אותם קודם.'
          : code === 'tour_has_bookings'
            ? 'לא ניתן למחוק סיור שיש לו הזמנות — ניתן רק לבטל אותו.'
            : 'שגיאה: ' + e.message,
      );
    } finally {
      setConfirmAction(null);
    }
  }

  const summary = useMemo(() => {
    const upcoming = rows.filter((t) => t.status === 'scheduled');
    return {
      upcoming: upcoming.length,
      groupSlots: upcoming.filter((t) => t.kind === 'group_slot').length,
      seats: upcoming.reduce((s, t) => s + (t.activeSeats || 0), 0),
    };
  }, [rows]);

  return (
    <div className="mx-auto max-w-[1600px] px-5 lg:px-8 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-lg shadow-sm">
            🧭
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 leading-tight">סיורים</h1>
            <p className="text-[12px] text-gray-500">ניהול תפעולי — סיורים מתוכננים והזמנות</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          + סיור קבוצתי חדש
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <SummaryCard label="סיורים מתוכננים" value={summary.upcoming} icon="🧭" />
        <SummaryCard label="סיורים קבוצתיים פתוחים" value={summary.groupSlots} icon="👥" />
        <SummaryCard label="משתתפים רשומים" value={summary.seats} icon="🎟️" />
      </div>

      {/* Tabs: table | calendar placeholder */}
      <div className="mb-3 flex items-center gap-1 border-b border-gray-200">
        <TabButton active={tab === 'table'} onClick={() => setTab('table')}>טבלה</TabButton>
        <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>לוח שנה</TabButton>
      </div>

      {tab === 'calendar' ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm py-20 text-center max-w-lg mx-auto">
          <div className="text-5xl mb-4 opacity-70">📅</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">תצוגת לוח שנה</h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            תצוגות יומן (חודשי / שבועי / יומי) יתווספו בשלב הבא.
            <br />
            בינתיים כל הסיורים זמינים בתצוגת הטבלה.
          </p>
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 mb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-[2] min-w-[260px]">
                <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">🔍</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש לפי מוצר, עיר או הערות…"
                  className="h-11 w-full rounded-lg border border-gray-300 bg-gray-50/60 pr-10 pl-3 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
              </div>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-10 min-w-[8rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              >
                {KIND_FILTERS.map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-10 min-w-[8rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
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
                <div className="text-5xl mb-4 opacity-70">🧭</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">אין סיורים עדיין</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  צרו סיור קבוצתי ראשון, או סגרו דיל (WON) כדי שסיור פרטי/עסקי ייווצר אוטומטית.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">לא נמצאו סיורים תואמים.</div>
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
                      <th className="w-28 border-s border-gray-100/70" />
                    </SortableHeaderRow>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((t) => (
                      <tr
                        key={t.id}
                        className={`group transition-colors hover:bg-blue-50/40 cursor-pointer ${
                          t.status === 'cancelled' ? 'opacity-60' : ''
                        }`}
                        onClick={() => navigate(`/admin/tours/${t.id}`)}
                        title="פתיחת עמוד הסיור"
                      >
                        {visibleCols.map((c) => (
                          <TableCell key={c.key} col={c}>{c.render(t)}</TableCell>
                        ))}
                        <td
                          className="px-3 py-3 align-middle border-s border-gray-100/70"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {t.kind === 'group_slot' && t.status !== 'cancelled' && (
                              <IconButton title="עריכה" onClick={() => openEdit(t)}>✎</IconButton>
                            )}
                            {t.status === 'scheduled' && (
                              <IconButton
                                title="ביטול סיור"
                                onClick={() => setConfirmAction({ type: 'cancel', tour: t })}
                              >
                                ⏸
                              </IconButton>
                            )}
                            {t.status === 'cancelled' && (
                              <IconButton
                                title="החזרה לתכנון"
                                onClick={() => setConfirmAction({ type: 'restore', tour: t })}
                              >
                                ↩
                              </IconButton>
                            )}
                            {t.totalBookings === 0 && (
                              <IconButton
                                title="מחיקה (סיור ריק בלבד)"
                                danger
                                onClick={() => setConfirmAction({ type: 'delete', tour: t })}
                              >
                                🗑
                              </IconButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <TourSlotModal
        open={modalOpen}
        tour={editTour}
        onClose={() => setModalOpen(false)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.type === 'delete'
            ? 'מחיקת סיור'
            : confirmAction?.type === 'restore'
              ? 'החזרת סיור לתכנון'
              : 'ביטול סיור'
        }
        body={
          confirmAction?.type === 'delete'
            ? 'למחוק את הסיור? רק סיורים ריקים (ללא הזמנות) ניתנים למחיקה. לא ניתן לבטל פעולה זו.'
            : confirmAction?.type === 'restore'
              ? 'להחזיר את הסיור לסטטוס עתידי?'
              : 'לבטל את הסיור? הסיור יישאר בהיסטוריה בסטטוס "בוטל".'
        }
        confirmLabel={
          confirmAction?.type === 'delete' ? 'מחק' : confirmAction?.type === 'restore' ? 'החזר' : 'בטל סיור'
        }
        danger={confirmAction?.type !== 'restore'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={runConfirmAction}
      />

      {/* The Tour page renders here as a modal ON TOP of this list (nested
          route). Closing it refreshes the list so status/seat changes show. */}
      <Outlet context={{ closeTour: () => { navigate('/admin/tours'); refresh(); } }} />
    </div>
  );
}

function SummaryCard({ label, value, icon }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xl">{icon}</div>
      <div>
        <div className="text-lg font-bold leading-tight text-gray-900 tabular-nums">{value}</div>
        <div className="text-[11px] text-gray-500">{label}</div>
      </div>
    </div>
  );
}

// Row-action icon button (edit / cancel / restore / delete). Local atom like
// SummaryCard/TabButton — no shared IconButton exists in the client yet; if
// one lands in admin/common this should switch to it.
function IconButton({ title, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-8 w-8 rounded-md text-gray-400 transition-colors ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-blue-50 hover:text-blue-700'
      }`}
    >
      {children}
    </button>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}
