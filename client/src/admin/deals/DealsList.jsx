import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor, toMinor } from '../../lib/money.js';
import { DEAL_STATUS_LABELS, DEAL_STATUS_STYLES } from './config.js';

// Deals — the CRM hub's primary tab. Operational list: compact summary +
// dominant search + status tabs + a roomy table. OPEN deals come first because
// they need action; ALL is last. דילים / OPEN·WON·LOST.

const PAGE_SIZE = 14;

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [stageId, setStageId] = useState('all');
  const [orgId, setOrgId] = useState('all');
  const [minVal, setMinVal] = useState('');
  const [maxVal, setMaxVal] = useState('');
  const [page, setPage] = useState(1);

  async function refresh() {
    setError(null);
    try {
      const [d, s, o] = await Promise.all([
        api.deals.list(),
        api.dealStages.list(),
        api.organizations.list(),
      ]);
      setDeals(d);
      setStages(s);
      setOrgs(o);
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
    <div className="mx-auto max-w-[1600px] px-5 lg:px-8 py-5">
      {/* Header — compact */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
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

      {/* Summary cards — compact, order OPEN · WON · LOST · ALL */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <MetricCard label="OPEN" n={summary.open.n} v={summary.open.v} tone="blue" icon="🕓" />
        <MetricCard label="WON" n={summary.won.n} v={summary.won.v} tone="emerald" icon="🏆" />
        <MetricCard label="LOST" n={summary.lost.n} v={summary.lost.v} tone="red" icon="✕" />
        <MetricCard label="ALL DEALS" n={summary.all.n} v={summary.all.v} tone="indigo" icon="🤝" />
      </div>

      {/* Filter bar — search dominant; status handled by the tabs below */}
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
        </div>
      </div>

      {/* Status tabs — order OPEN · WON · LOST · הכל */}
      <div className="flex flex-wrap gap-2 mb-3">
        <StatusTab active={status === 'open'} onClick={() => setStatus('open')} label="OPEN" n={summary.open.n} tone="open" />
        <StatusTab active={status === 'won'} onClick={() => setStatus('won')} label="WON" n={summary.won.n} tone="won" />
        <StatusTab active={status === 'lost'} onClick={() => setStatus('lost')} label="LOST" n={summary.lost.n} tone="lost" />
        <StatusTab active={status === 'all'} onClick={() => setStatus('all')} label="הכל" n={summary.all.n} tone="all" />
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
                  <tr className="text-gray-500 bg-gray-50/70 border-b border-gray-100">
                    <Th>שם דיל</Th>
                    <Th>ארגון</Th>
                    <Th>שלב</Th>
                    <Th>סטטוס</Th>
                    <Th className="text-left">סכום</Th>
                    <Th>אחראי</Th>
                    <Th>תאריך עדכון</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageRows.map((d) => (
                    <DealRow
                      key={d.id}
                      deal={d}
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
          stages={stages}
          orgs={orgs}
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

function MetricCard({ label, n, v, tone, icon }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex items-center justify-between">
      <div>
        <div className={`text-[11px] font-semibold tracking-wide ${TONE_TEXT[tone]}`}>{label}</div>
        <div className="text-2xl font-bold text-gray-900 mt-0.5 leading-none">{n}</div>
        <div className="text-[12px] text-gray-500 mt-1 tabular-nums" dir="ltr">{formatMinor(v, 'ILS')}</div>
      </div>
      <div className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-lg ring-1 ${TONES[tone]}`}>
        {icon}
      </div>
    </div>
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

const TAB_TONE = {
  all: 'text-blue-700 border-blue-300 bg-blue-50',
  open: 'text-blue-700 border-blue-300 bg-blue-50',
  won: 'text-emerald-700 border-emerald-300 bg-emerald-50',
  lost: 'text-red-700 border-red-300 bg-red-50',
};
function StatusTab({ active, onClick, label, n, tone }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        active ? TAB_TONE[tone] : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
      <span className={`inline-flex min-w-[1.4rem] justify-center rounded-full px-1.5 py-0.5 text-[11px] ${
        active ? 'bg-white/70' : 'bg-gray-100 text-gray-600'
      }`}>{n}</span>
    </button>
  );
}

function DealRow({ deal, stageCls, onOpen, onDelete }) {
  return (
    <tr className="group hover:bg-blue-50/40 cursor-pointer transition-colors" onClick={onOpen}>
      <Td>
        <div className="font-semibold text-gray-900 text-[15px] group-hover:text-blue-700">{deal.title}</div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
          <span>{deal._count?.contacts ?? 0} אנשי קשר</span>
          {/* Reserved slot for future row indicators (open activity / WhatsApp /
              email). Intentionally empty until those integrations are built. */}
          <span className="flex items-center gap-1" />
        </div>
      </Td>
      <Td className="text-gray-600">{deal.organization?.name || <span className="text-gray-400">—</span>}</Td>
      <Td>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${stageCls || 'bg-gray-50 text-gray-600 ring-gray-100'}`}>
          {deal.dealStage?.label}
        </span>
      </Td>
      <Td>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${DEAL_STATUS_STYLES[deal.status]}`}>
          {DEAL_STATUS_LABELS[deal.status]}
        </span>
      </Td>
      <Td className="text-left font-bold text-gray-900 text-[15px] tabular-nums" dir="ltr">
        {formatMinor(deal.valueMinor, deal.currency)}
      </Td>
      <Td><span className="text-gray-400">—</span></Td>
      <Td className="text-gray-500 tabular-nums" dir="ltr">{fmtDate(deal.updatedAt)}</Td>
      <Td onClickStop>
        <KebabMenu onOpen={onOpen} onDelete={onDelete} />
      </Td>
    </tr>
  );
}

function KebabMenu({ onOpen, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} className="h-8 w-8 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="פעולות">⋮</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 min-w-[9rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button onClick={() => { setOpen(false); onOpen(); }} className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50">פתח דיל</button>
            <button onClick={() => { setOpen(false); onDelete(); }} className="block w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50">מחק דיל</button>
          </div>
        </>
      )}
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

function CreateDealModal({ stages, orgs, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [orgId, setOrgId] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const deal = await api.deals.create({
        title: title.trim(),
        organizationId: orgId || null,
        dealStageId: stageId || null,
        valueMinor: toMinor(value) ?? 0,
      });
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
      <form onSubmit={submit} className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">דיל חדש</h2>
        <Field label="שם הדיל">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: סדנאות לבית ספר אליאנס"
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ארגון (אופציונלי)">
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="">— ללא —</option>
              {orgs.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
            </select>
          </Field>
          <Field label="שלב">
            <select value={stageId} onChange={(e) => setStageId(e.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              {stages.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
          </Field>
        </div>
        <Field label="שווי (₪)">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0"
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        </Field>
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={busy || !title.trim()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'יוצר…' : 'צור דיל'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
        </div>
      </form>
    </div>
  );
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
