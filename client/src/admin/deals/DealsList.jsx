import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor, toMinor } from '../../lib/money.js';
import { contactNamesFromFull } from '../../lib/nameSplit.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import { DEAL_STATUS_LABELS, DEAL_STATUS_STYLES } from './config.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import { useTableColumns, ColumnPicker, SortableHeaderRow } from '../common/tableColumns.jsx';
import { OrgPicker, resolveOrganization } from '../crm/common/OrgPicker.jsx';

const MODAL_INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Deals — the CRM hub's primary tab. Operational list: compact summary +
// dominant search + a roomy, user-configurable table. OPEN deals come first
// because they need action; ALL is last. דילים / OPEN·WON·LOST.

const PAGE_SIZE = 14;
const FILTERS_KEY = 'deals.filters.v1';
const COLUMNS_KEY = 'deals.columns.v1';

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
    render: (d) => <span className="font-semibold text-gray-900 text-[15px] group-hover:text-blue-700">{d.title}</span> },
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
  { key: 'amount', label: 'סכום', def: true, align: 'left', dir: 'ltr',
    cls: 'text-left font-bold text-gray-900 text-[15px] tabular-nums',
    render: (d) => formatMinor(d.valueMinor, d.currency) },
  { key: 'discount', label: 'הנחה', def: false, align: 'left', dir: 'ltr',
    cls: 'text-left tabular-nums text-gray-600',
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
  { key: 'updatedAt', label: 'תאריך עדכון', def: true, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (d) => fmtDate(d.updatedAt) },
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

export default function DealsList() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState([]);
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

  // Persist whenever any filter changes.
  useEffect(() => {
    saveFilters({ search, status, stageId, orgId, minVal, maxVal });
  }, [search, status, stageId, orgId, minVal, maxVal]);

  // Visible table columns + user order — persisted via the shared hook
  // (column chooser + drag-reorderable headers).
  const { colKeys, toggleCol, moveCol, visibleCols, orderedColumns } =
    useTableColumns(COLUMNS_KEY, COLUMNS);

  async function refresh() {
    setError(null);
    try {
      const [d, s, o, ty, st, src] = await Promise.all([
        api.deals.list(),
        api.dealStages.list(),
        api.organizations.list(),
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
        api.dealSources.list(),
      ]);
      setDeals(d);
      setStages(s);
      setOrgs(o);
      setTypes(ty);
      setSubtypes(st);
      setSources(src);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const stageColor = useMemo(() => {
    const m = new Map();
    stages.forEach((s, i) => m.set(s.id, STAGE_PILL[i % STAGE_PILL.length]));
    return m;
  }, [stages]);

  const summary = useMemo(() => {
    const acc = { all: { n: 0, v: 0 }, open: { n: 0, v: 0 }, won: { n: 0, v: 0 }, lost: { n: 0, v: 0 } };
    for (const d of deals) {
      const v = Number(d.valueMinor || 0);
      acc.all.n++; acc.all.v += v;
      if (acc[d.status]) { acc[d.status].n++; acc[d.status].v += v; }
    }
    return acc;
  }, [deals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = toMinor(minVal);
    const max = toMinor(maxVal);
    return deals.filter((d) => {
      if (status !== 'all' && d.status !== status) return false;
      if (stageId !== 'all' && d.dealStageId !== stageId) return false;
      if (orgId !== 'all' && d.organizationId !== orgId) return false;
      const v = Number(d.valueMinor || 0);
      if (min !== null && v < min) return false;
      if (max !== null && v > max) return false;
      if (q) {
        const hay = [d.title, d.organization?.name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, search, status, stageId, orgId, minVal, maxVal]);

  useEffect(() => setPage(1), [search, status, stageId, orgId, minVal, maxVal]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        <MetricCard label="OPEN" n={summary.open.n} v={summary.open.v} tone="blue" icon="🕓"
          active={status === 'open'} onClick={() => setStatus('open')} />
        <MetricCard label="WON" n={summary.won.n} v={summary.won.v} tone="emerald" icon="🏆"
          active={status === 'won'} onClick={() => setStatus('won')} />
        <MetricCard label="LOST" n={summary.lost.n} v={summary.lost.v} tone="red" icon="✕"
          active={status === 'lost'} onClick={() => setStatus('lost')} />
        <MetricCard label="ALL" n={summary.all.n} v={summary.all.v} tone="indigo" icon="🤝"
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
        ) : deals.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : filtered.length === 0 ? (
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
                    cols={visibleCols}
                    onMove={moveCol}
                    trClassName="text-gray-500 bg-gray-50/70 border-b border-gray-100"
                    thClassName={(c) =>
                      c.align === 'left' ? 'text-left' : c.align === 'center' ? 'text-center' : ''
                    }
                  >
                    <Th className="w-10" />
                  </SortableHeaderRow>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageRows.map((d) => (
                    <DealRow
                      key={d.id}
                      deal={d}
                      cols={visibleCols}
                      stageCls={stageColor.get(d.dealStageId)}
                      onOpen={() => navigate(`/admin/crm/deals/${d.id}`)}
                      onDelete={async () => {
                        if (!confirm(`למחוק את הדיל "${d.title}"?`)) return;
                        try { await api.deals.remove(d.id); await refresh(); }
                        catch (e) { alert('שגיאה: ' + e.message); }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 text-[13px] text-gray-600">
                <span>{(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} מתוך {filtered.length}</span>
                <div className="flex items-center gap-1">
                  <PagerBtn disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</PagerBtn>
                  <span className="px-2">{page} / {pageCount}</span>
                  <PagerBtn disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>›</PagerBtn>
                </div>
              </div>
            )}
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
          onCreated={(deal) => navigate(`/admin/crm/deals/${deal.id}`)}
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
          <span className="truncate text-[11px] text-gray-500 tabular-nums" dir="ltr">{formatMinor(v, 'ILS')}</span>
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
        <Td key={c.key} className={c.cls || ''} dir={c.dir}>
          {c.kind === 'stage' ? (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${stageCls || 'bg-gray-50 text-gray-600 ring-gray-100'}`}>
              {deal.dealStage?.label}
            </span>
          ) : (
            c.render(deal)
          )}
        </Td>
      ))}
      <Td onClickStop>
        <KebabMenu onOpen={onOpen} onDelete={onDelete} />
      </Td>
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

// Create Deal — optimised around how a lead actually arrives: first the PERSON
// (full name + phone + source), not stage/value. It creates the contact, the
// deal, and links them in one flow, reusing the existing contacts/deals APIs.
// Stage defaults to the first pipeline stage server-side and value defaults to 0
// — both intentionally out of the lead-capture flow (still backend-compatible).
function CreateDealModal({ orgs, types, subtypes, sources, onClose, onCreated }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [inquiry, setInquiry] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sourceFree, setSourceFree] = useState('');
  const [showBiz, setShowBiz] = useState(false);
  const [orgRes, setOrgRes] = useState(null); // resolution from the shared OrgPicker
  const [busy, setBusy] = useState(false);

  // Auto-derive the deal title from the full name until the user edits it.
  useEffect(() => {
    if (!titleTouched) setTitle(fullName.trim());
  }, [fullName, titleTouched]);

  const activeSources = sources.filter((s) => s.active);
  // A new organization requires a type (OrgPicker reports `invalid`); gate only
  // while the org section is open.
  const orgInvalid = showBiz && orgRes?.invalid;
  const ready = fullName.trim() && phone.trim() && sourceId && !orgInvalid;

  // Unsaved-work guard (auto-update): dirty once real lead data is entered; clears
  // on revert, and on create/cancel (the modal unmounts). The modal is only ever
  // mounted while open, so no extra gating is needed.
  useDirtyWhen(
    { fullName, phone, email, inquiry, sourceId, sourceFree, org: !!orgRes },
    { fullName: '', phone: '', email: '', inquiry: '', sourceId: '', sourceFree: '', org: false },
  );

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      // 1) Contact from the single full-name field (split) + phone (+ email).
      const contact = await api.contacts.create(contactNamesFromFull(fullName));
      await api.contacts.addPhone(contact.id, { value: phone.trim(), isPrimary: true });
      if (email.trim()) {
        await api.contacts.addEmail(contact.id, { value: email.trim(), isPrimary: true });
      }

      // 2) Resolve the organization (existing match | new) BEFORE the deal, via
      //    the shared OrgPicker helper — no duplicate org logic. A new org owns
      //    its type; the subtype is the deal-level field; the backend keeps
      //    Deal.organizationTypeId null while an org is linked (no duplicate truth).
      let orgFields = {};
      if (showBiz && orgRes && (orgRes.isExisting || orgRes.isNew)) {
        const { organizationId } = await resolveOrganization(orgRes);
        if (organizationId) {
          orgFields = {
            activityType: 'business',
            organizationId,
            organizationSubtypeId: orgRes.subtypeId || null,
          };
        }
      }

      // 3) The deal. Source → catalog ref; sourceFree → free text. The inquiry is
      //    NOT stored on the deal anymore — it becomes the first timeline note.
      const deal = await api.deals.create({
        title: title.trim() || fullName.trim(),
        dealSourceId: sourceId,
        source: sourceFree.trim() || null,
        ...orgFields,
      });

      // 4) Link the new contact as the deal's primary contact.
      await api.deals.addContact(deal.id, { contactId: contact.id, isPrimary: true });

      // 5) Inquiry content → the deal's FIRST timeline note. A completely normal
      //    note, only tagged origin:'inquiry' so the feed renders a small
      //    "תוכן הפנייה" label above it. Best-effort: must not block the new deal.
      if (inquiry.trim()) {
        try {
          await api.timeline.create({
            subjectType: 'deal',
            subjectId: deal.id,
            kind: 'note',
            body: plainToHtml(inquiry),
            data: { origin: 'inquiry' },
          });
        } catch {
          /* non-fatal — the deal is already created */
        }
      }

      onCreated(deal);
    } catch (e) {
      alert('שגיאה ביצירת דיל: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">דיל חדש</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">פנייה חדשה — מי פנה, באיזה טלפון ומאיפה הגיע.</p>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <Field label="שם מלא *">
            <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="לדוגמה: ישראל ישראלי" className={MODAL_INPUT} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="טלפון *">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" className={MODAL_INPUT} />
            </Field>
            <Field label="אימייל">
              <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={MODAL_INPUT} />
            </Field>
          </div>
          <Field label="כותרת הדיל">
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              placeholder="נוצר אוטומטית מהשם"
              className={MODAL_INPUT}
            />
          </Field>
          <Field label="תוכן הפנייה">
            <textarea value={inquiry} onChange={(e) => setInquiry(e.target.value)} rows={3} placeholder="מה הם רוצים? מה נאמר בפנייה הראשונה…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
          </Field>
          <Field label="מקור *">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={`${MODAL_INPUT} bg-white`}>
              <option value="">— בחר מקור —</option>
              {activeSources.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
            {activeSources.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">אין מקורות מוגדרים. הוסיפו ב: הגדרות CRM ← מקורות דיל.</p>
            )}
          </Field>
          <Field label="פירוט מקור (אופציונלי)">
            <input value={sourceFree} onChange={(e) => setSourceFree(e.target.value)} placeholder="לדוגמה: קמפיין פייסבוק, שם ממליץ, כנס…" className={MODAL_INPUT} />
          </Field>

          {/* Optional organization — ONE free-typed field with autocomplete.
              Pick a suggestion (or type an exact existing name) → existing org,
              type locked (it is the source of truth). Type a fresh name → a new
              org is created + linked on save. No "existing vs new" decision up
              front — typing is enough. */}
          {!showBiz ? (
            <button type="button" onClick={() => setShowBiz(true)} className="text-sm font-medium text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1.5">
              + הוסף ארגון
            </button>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-gray-700">ארגון</span>
                <button
                  type="button"
                  onClick={() => { setShowBiz(false); setOrgRes(null); }}
                  className="text-[12px] text-gray-500 hover:text-gray-700"
                >
                  הסר
                </button>
              </div>
              <OrgPicker orgs={orgs} types={types} subtypes={subtypes} showSubtype onResolve={setOrgRes} />
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex gap-2">
          <button type="submit" disabled={busy || !ready} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'יוצר…' : 'צור דיל'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
        </div>
      </form>
    </div>
  );
}

// Wrap plain textarea text as simple rich HTML (paragraphs + line breaks) so the
// imported inquiry reads as a normal rich note in the timeline.
function plainToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).split('\n').join('<br>')}</p>`)
    .join('');
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      {children}
    </label>
  );
}
function Th({ children, className = '' }) {
  return <th className={`text-right text-[11px] uppercase tracking-wide font-semibold px-4 py-2.5 ${className}`}>{children}</th>;
}
function Td({ children, className = '', dir, onClickStop }) {
  return (
    <td className={`px-4 py-3 align-middle ${className}`} dir={dir} onClick={onClickStop ? (e) => e.stopPropagation() : undefined}>
      {children}
    </td>
  );
}
function PagerBtn({ children, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} className="h-8 w-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">{children}</button>
  );
}
