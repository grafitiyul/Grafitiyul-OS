import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import { formatMinor } from '../../lib/money.js';
import { DEAL_STATUS_LABELS, DEAL_STATUS_STYLES, dealPath } from './config.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell } from '../common/tableColumns.jsx';
import PageSizeSelector, { usePageSizePref } from '../common/PageSizeSelector.jsx';
import Pager from '../common/Pager.jsx';
import useDebouncedValue from '../../shell/search/useDebouncedValue.js';
import CreateDealModal from './CreateDealModal.jsx';

// Deals — the CRM hub's primary tab. Operational list: compact summary +
// dominant search + a roomy, user-configurable table. OPEN deals come first
// because they need action; ALL is last. דילים / OPEN·WON·LOST.

const FILTERS_KEY = 'deals.filters.v1';
const COLUMNS_KEY = 'deals.columns.v1';
const PAGESIZE_KEY = 'deals.pageSize.v1';

// Column key → server sort key. Only these columns are click-to-sort; the rest
// have no server-side sort and stay reorder-only (sortable:false). The server
// default is activity:desc — latest MEANINGFUL business activity, not the
// technical updatedAt — so that is our initial sort too.
const SORT_KEY = {
  name: 'title',
  amount: 'valueMinor',
  expectedClose: 'expectedClose',
  createdAt: 'createdAt',
  updatedAt: 'activity',
};

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
    /* storage unavailable — non-fatal, filters just won't persist */
  }
}

function fullName(c) {
  if (!c) return '';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  if (he) return he;
  return `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim();
}
const dash = <span className="text-gray-400">—</span>;

// Available table columns — all backed by fields the list API already returns
// (no raw internal IDs are ever rendered). `owner` is deferred: there is no User
// model yet, only a loose ownerUserId we must not surface, so it's disabled.
// `def` = part of the safe default set shown to first-time users.
const COLUMNS = [
  { key: 'name', label: 'שם דיל', def: true,
    render: (d) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-semibold text-gray-900 text-[15px] group-hover:text-blue-700">{d.title}</span>
        <UnreadChannels deal={d} />
      </span>
    ) },
  { key: 'organization', label: 'ארגון', def: true,
    render: (d) => d.organization?.name || dash, cls: 'text-gray-600' },
  { key: 'unit', label: 'יחידה', def: false,
    render: (d) => d.organizationUnit?.name || dash, cls: 'text-gray-600' },
  { key: 'subtype', label: 'תת-סוג', def: false,
    render: (d) => d.organizationSubtype?.label || dash, cls: 'text-gray-600' },
  { key: 'stage', label: 'שלב', def: true, kind: 'stage' },
  { key: 'status', label: 'סטטוס', def: true,
    render: (d) => (
      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${DEAL_STATUS_STYLES[d.status]}`}>
        {DEAL_STATUS_LABELS[d.status]}
      </span>
    ) },
  { key: 'amount', label: 'סכום', def: true, dir: 'ltr',
    cls: 'font-bold text-gray-900 text-[15px] tabular-nums',
    render: (d) => formatMinor(d.valueMinor, d.currency) },
  { key: 'discount', label: 'הנחה', def: false, dir: 'ltr',
    cls: 'tabular-nums text-gray-600',
    render: (d) => (d.discountMinor != null ? formatMinor(d.discountMinor, d.currency) : dash) },
  { key: 'paymentTerms', label: 'תנאי תשלום', def: false,
    render: (d) => d.paymentTerms || dash, cls: 'text-gray-600' },
  { key: 'source', label: 'מקור', def: false,
    render: (d) => d.source || dash, cls: 'text-gray-600' },
  { key: 'expectedClose', label: 'תאריך סגירה צפוי', def: false, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (d) => fmtDate(d.expectedCloseDate) },
  { key: 'closedDate', label: 'תאריך סגירה', def: false, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (d) => fmtDate(d.wonAt || d.lostAt) },
  { key: 'lostReason', label: 'סיבת LOST', def: false,
    render: (d) => d.lostReasonRef?.nameHe || d.lostReason || dash, cls: 'text-gray-600' },
  { key: 'contactCount', label: 'אנשי קשר', def: false, align: 'center',
    cls: 'text-center tabular-nums text-gray-600', render: (d) => d._count?.contacts ?? 0 },
  { key: 'primaryContact', label: 'איש קשר ראשי', def: false, cls: 'text-gray-600',
    render: (d) => fullName(d.contacts?.[0]?.contact) || dash },
  { key: 'createdAt', label: 'תאריך יצירה', def: false, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (d) => fmtDate(d.createdAt) },
  // Shows lastMeaningfulActivityAt — when a human-visible thing last
  // happened on the deal (note, stage move, task, payment, delivery…), never
  // a worker's technical touch. Falls back to createdAt pre-backfill.
  { key: 'updatedAt', label: 'פעילות אחרונה', def: true, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (d) => fmtDateTime(d.lastMeaningfulActivityAt || d.createdAt) },
  { key: 'owner', label: 'אחראי', def: false, disabled: true,
    render: () => dash, cls: 'text-gray-600' },
];
const STAGE_PILL = [
  'bg-blue-50 text-blue-700 ring-blue-100',
  'bg-violet-50 text-violet-700 ring-violet-100',
  'bg-amber-50 text-amber-700 ring-amber-100',
  'bg-cyan-50 text-cyan-700 ring-cyan-100',
  'bg-pink-50 text-pink-700 ring-pink-100',
  'bg-emerald-50 text-emerald-700 ring-emerald-100',
];

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

// Date + TIME — the list is ORDERED at timestamp precision, so the column that
// explains that order must show it; a bare date makes same-day rows look
// arbitrarily sorted.
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

// "This deal is waiting on you" — one icon per channel with unread messages,
// both when both are unread, none when everything is read. Server-computed
// from the canonical inbox read state (WhatsAppChat / EmailThread), so an icon
// clears the moment the conversation is read anywhere: GOS, the phone, Gmail.
function UnreadChannels({ deal }) {
  if (!deal.unreadWhatsapp && !deal.unreadEmail) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {deal.unreadWhatsapp && (
        <span title="הודעות WhatsApp שלא נקראו" aria-label="הודעות WhatsApp שלא נקראו" className="inline-flex">
          <WhatsAppLogo size={14} />
        </span>
      )}
      {deal.unreadEmail && (
        <span title="מיילים שלא נקראו" aria-label="מיילים שלא נקראו" className="text-[13px] leading-none">
          ✉️
        </span>
      )}
    </span>
  );
}

export default function DealsList() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({
    open: { count: 0, sumMinor: 0 }, won: { count: 0, sumMinor: 0 },
    lost: { count: 0, sumMinor: 0 }, all: { count: 0, sumMinor: 0 },
  });
  const [stages, setStages] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [types, setTypes] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // Filters persist across refresh / navigation / logout via localStorage, so
  // the user always returns to the exact same filtered workspace.
  const [saved] = useState(loadFilters);
  const [search, setSearch] = useState(saved.search ?? '');
  const [status, setStatus] = useState(saved.status ?? 'all');
  const [stageId, setStageId] = useState(saved.stageId ?? 'all');
  const [orgId, setOrgId] = useState(saved.orgId ?? 'all');
  const [minVal, setMinVal] = useState(saved.minVal ?? '');
  const [maxVal, setMaxVal] = useState(saved.maxVal ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSizePref(PAGESIZE_KEY);
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' });
  const [refreshKey, setRefreshKey] = useState(0);

  // Debounce free-typed inputs so a burst of keystrokes costs one request.
  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedMin = useDebouncedValue(minVal, 300);
  const debouncedMax = useDebouncedValue(maxVal, 300);

  // Persist whenever any filter changes.
  useEffect(() => {
    saveFilters({ search, status, stageId, orgId, minVal, maxVal });
  }, [search, status, stageId, orgId, minVal, maxVal]);

  // Visible table columns + user order — persisted via the shared hook
  // (column chooser + drag-reorderable headers).
  const { colKeys, toggleCol, moveCol, setColWidth, widths, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  // Reference catalogs (stage/org/type/subtype/source filters + create modal) —
  // small lists, loaded once. Deals themselves come from the paginated fetch.
  useEffect(() => {
    Promise.all([
      api.dealStages.list(),
      api.organizations.list(),
      api.organizationTypes.list(),
      api.organizationSubtypes.list(),
      api.dealSources.list(),
    ])
      .then(([s, o, ty, st, src]) => {
        setStages(s);
        setOrgs(o);
        setTypes(ty);
        setSubtypes(st);
        setSources(src);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Common server filter params (status excluded — added per call). 'all'
  // sentinels map to undefined so qs drops them.
  const baseParams = useMemo(
    () => ({
      search: debouncedSearch,
      stageId: stageId === 'all' ? undefined : stageId,
      organizationId: orgId === 'all' ? undefined : orgId,
      minVal: debouncedMin || undefined,
      maxVal: debouncedMax || undefined,
    }),
    [debouncedSearch, stageId, orgId, debouncedMin, debouncedMax],
  );

  // Reset to the first page whenever a filter / search / sort / page size changes.
  useEffect(() => {
    setPage(1);
  }, [baseParams, status, sort, pageSize]);

  // The paginated deals fetch — one page of rows + the matching total.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.deals
      .list({
        ...baseParams,
        status: status === 'all' ? undefined : status,
        page,
        pageSize,
        sort: `${SORT_KEY[sort.key] || 'activity'}:${sort.dir}`,
      })
      .then((data) => {
        if (!live) return;
        setDeals(data.rows);
        setTotal(data.total);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [baseParams, status, page, pageSize, sort, refreshKey]);

  // Status-card count + money SUM per status under the SAME search/stage/org/
  // value filters (independent of which card is selected) — one grouped server
  // query, so the sums are correct across the whole filtered set, not a page.
  useEffect(() => {
    let live = true;
    api.deals.summary(baseParams)
      .then((s) => { if (live) setSummary(s); })
      .catch(() => {});
    return () => { live = false; };
  }, [baseParams, refreshKey]);

  const stageColor = useMemo(() => {
    const m = new Map();
    stages.forEach((s, i) => m.set(s.id, STAGE_PILL[i % STAGE_PILL.length]));
    return m;
  }, [stages]);

  // Header cells: only server-sortable columns are click-to-sort; the rest stay
  // reorder-only so a click can never request an unsupported sort key.
  const headerCols = useMemo(
    () => visibleCols.map((c) => (SORT_KEY[c.key] ? c : { ...c, sortable: false })),
    [visibleCols],
  );

  function handleSort(colKey) {
    if (!SORT_KEY[colKey]) return;
    setSort((s) =>
      s.key === colKey
        ? { key: colKey, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: colKey, dir: 'desc' },
    );
  }

  const hasFilters = search || stageId !== 'all' || orgId !== 'all' || minVal || maxVal;
  function clearFilters() {
    setSearch(''); setStageId('all'); setOrgId('all'); setMinVal(''); setMaxVal('');
  }

  return (
    <div className="mx-auto max-w-[1600px] px-5 lg:px-8 py-4">
      {/* Header — compact */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-lg shadow-sm">
            💼
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 leading-tight">דילים</h1>
            <p className="text-[12px] text-gray-500">צפייה, ניהול ומעקב אחרי דילים במערכת</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          + דיל חדש
        </button>
      </div>

      {/* Summary cards double as the status filter — click to filter.
          Order OPEN · WON · LOST · ALL. Compact "dashboard widgets". */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <MetricCard label="OPEN" n={summary.open.count} v={summary.open.sumMinor} tone="blue" icon="🕓"
          active={status === 'open'} onClick={() => setStatus('open')} />
        <MetricCard label="WON" n={summary.won.count} v={summary.won.sumMinor} tone="emerald" icon="🏆"
          active={status === 'won'} onClick={() => setStatus('won')} />
        <MetricCard label="LOST" n={summary.lost.count} v={summary.lost.sumMinor} tone="red" icon="✕"
          active={status === 'lost'} onClick={() => setStatus('lost')} />
        <MetricCard label="ALL" n={summary.all.count} v={summary.all.sumMinor} tone="indigo" icon="🤝"
          active={status === 'all'} onClick={() => setStatus('all')} />
      </div>

      {/* Filter bar — search dominant; status is driven by the cards above */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 mb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-[2] min-w-[260px]">
            <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם דיל, ארגון, איש קשר..."
              className="h-11 w-full rounded-lg border border-gray-300 bg-gray-50/60 pr-10 pl-3 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
          <CompactSelect value={stageId} onChange={setStageId}
            options={[['all', 'כל השלבים'], ...stages.map((s) => [s.id, s.label])]} />
          <CompactSelect value={orgId} onChange={setOrgId}
            options={[['all', 'כל הארגונים'], ...orgs.map((o) => [o.id, o.name])]} />
          <div className="flex items-center gap-1.5">
            <input value={minVal} onChange={(e) => setMinVal(e.target.value)} inputMode="decimal" placeholder="מ-₪" dir="ltr"
              className="h-10 w-20 rounded-lg border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-gray-300">–</span>
            <input value={maxVal} onChange={(e) => setMaxVal(e.target.value)} inputMode="decimal" placeholder="עד ₪" dir="ltr"
              className="h-10 w-20 rounded-lg border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm text-blue-700 hover:underline px-1">נקה פילטרים</button>
          )}
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
        ) : total === 0 && !hasFilters && status === 'all' ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : deals.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-sm text-gray-500 mb-2">לא נמצאו דילים תואמים</div>
            <button onClick={clearFilters} className="text-sm text-blue-700 hover:underline">נקה פילטרים</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <SortableHeaderRow
                    cols={headerCols}
                    onMove={moveCol}
                    widths={widths}
                    onResize={setColWidth}
                    sort={sort}
                    onSort={handleSort}
                    trClassName="text-gray-500 bg-gray-50/70 border-b border-gray-100"
                  >
                    <Th className="w-10 border-s border-gray-100/70" />
                  </SortableHeaderRow>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deals.map((d) => (
                    <DealRow
                      key={d.id}
                      deal={d}
                      cols={visibleCols}
                      stageCls={stageColor.get(d.dealStage?.id)}
                      onOpen={() => navigate(dealPath(d))}
                      onDelete={async () => {
                        if (!confirm(`למחוק את הדיל "${d.title}"?`)) return;
                        try { await api.deals.remove(d.id); setRefreshKey((k) => k + 1); }
                        catch (e) { alert('שגיאה: ' + e.message); }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage}>
              <PageSizeSelector value={pageSize} onChange={setPageSize} />
            </Pager>
          </>
        )}
      </div>

      {showCreate && (
        <CreateDealModal
          orgs={orgs}
          types={types}
          subtypes={subtypes}
          sources={sources}
          onClose={() => setShowCreate(false)}
          onCreated={(deal) => navigate(dealPath(deal))}
        />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  red: 'bg-red-50 text-red-600 ring-red-100',
};
const TONE_TEXT = {
  indigo: 'text-indigo-700',
  blue: 'text-blue-700',
  emerald: 'text-emerald-700',
  red: 'text-red-700',
};

const TONE_ACTIVE = {
  indigo: 'border-indigo-300 ring-2 ring-indigo-200 bg-indigo-50/50',
  blue: 'border-blue-300 ring-2 ring-blue-200 bg-blue-50/50',
  emerald: 'border-emerald-300 ring-2 ring-emerald-200 bg-emerald-50/50',
  red: 'border-red-300 ring-2 ring-red-200 bg-red-50/50',
};

// Compact dashboard widget that also acts as the status filter. Count and
// amount sit on one line to keep the card short — the table is the focus.
function MetricCard({ label, n, v, tone, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-right shadow-sm transition ${
        active ? TONE_ACTIVE[tone] : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="min-w-0">
        <div className={`text-[10px] font-semibold tracking-wide ${TONE_TEXT[tone]}`}>{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold leading-none text-gray-900">{n}</span>
          {v != null && (
            <span className="truncate text-[11px] text-gray-500 tabular-nums" dir="ltr">{formatMinor(v, 'ILS')}</span>
          )}
        </div>
      </div>
      <span className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-sm ring-1 ${TONES[tone]}`}>
        {icon}
      </span>
    </button>
  );
}

function CompactSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 min-w-[8rem] max-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
    >
      {options.map(([val, lbl]) => (<option key={val} value={val}>{lbl}</option>))}
    </select>
  );
}

function DealRow({ deal, cols, stageCls, onOpen, onDelete }) {
  return (
    <tr className="group hover:bg-blue-50/40 cursor-pointer transition-colors" onClick={onOpen}>
      {cols.map((c) => (
        <TableCell key={c.key} col={c}>
          {c.kind === 'stage' ? (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${stageCls || 'bg-gray-50 text-gray-600 ring-gray-100'}`}>
              {deal.dealStage?.label}
            </span>
          ) : (
            c.render(deal)
          )}
        </TableCell>
      ))}
      <TableCell stopClick>
        <KebabMenu onOpen={onOpen} onDelete={onDelete} />
      </TableCell>
    </tr>
  );
}

function KebabMenu({ onOpen, onDelete }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="h-8 w-8 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        aria-label="פעולות"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={160}>
        <button onClick={() => { setOpen(false); onOpen(); }} className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50">פתח דיל</button>
        <button onClick={() => { setOpen(false); onDelete(); }} className="block w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50">מחק דיל</button>
      </AnchoredMenu>
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="py-20 text-center max-w-sm mx-auto">
      <div className="text-5xl mb-4 opacity-70">💼</div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">אין דילים להצגה</h3>
      <p className="text-sm text-gray-500 mb-5 leading-relaxed">צור את הדיל הראשון שלך כדי להתחיל לנהל את תהליך המכירה.</p>
      <button onClick={onCreate} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">+ דיל חדש</button>
    </div>
  );
}

function Th({ children, className = '' }) {
  return <th className={`text-right text-[11px] uppercase tracking-wide font-semibold px-4 py-2.5 ${className}`}>{children}</th>;
}
