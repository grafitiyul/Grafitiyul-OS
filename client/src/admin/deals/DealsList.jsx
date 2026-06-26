import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor, toMinor } from '../../lib/money.js';
import { DEAL_STATUS_LABELS, DEAL_STATUS_STYLES } from './config.js';

const STATUS_FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'open', label: 'פתוחות' },
  { key: 'won', label: 'נסגרו' },
  { key: 'lost', label: 'אבודות' },
];

// Deals list. Not the daily working screen (that will be Activities) — this is
// the deal management/overview list. From a deal you reach contacts, org, etc.
export default function DealsList() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState([]);
  const [stages, setStages] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  // New-deal form
  const [title, setTitle] = useState('');
  const [orgId, setOrgId] = useState('');
  const [stageId, setStageId] = useState('');
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState(false);

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
      if (!stageId && s.length) setStageId(s[0].id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createDeal(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const deal = await api.deals.create({
        title: title.trim(),
        organizationId: orgId || null,
        dealStageId: stageId || null,
        valueMinor: toMinor(value) ?? 0,
      });
      setTitle('');
      setValue('');
      setOrgId('');
      navigate(`/admin/deals/${deal.id}`);
    } catch (e) {
      alert('שגיאה ביצירת עסקה: ' + (e.payload?.error || e.message));
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (q) {
        const hay = [d.title, d.organization?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, statusFilter, search]);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">עסקאות</h1>
        <span className="text-sm text-gray-400">({deals.length})</span>
        <div className="flex-1" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש…"
          className="h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </div>

      {/* New deal */}
      <form
        onSubmit={createDeal}
        className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mb-6 flex flex-wrap items-end gap-2"
      >
        <Field label="כותרת העסקה" className="flex-1 min-w-[180px]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="לדוגמה: סדנאות לבית ספר אליאנס"
            className="h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </Field>
        <Field label="ארגון (אופציונלי)">
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white w-48"
          >
            <option value="">— ללא —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שלב">
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white w-40"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שווי (₪)">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 w-28"
            dir="ltr"
          />
        </Field>
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? 'יוצר…' : 'עסקה חדשה'}
        </button>
      </form>

      {/* Filters */}
      <div className="flex gap-1.5 mb-3">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] border transition ${
              statusFilter === f.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="py-12 text-center text-sm text-gray-400">טוען…</div>}
      {error && (
        <div className="py-4 text-center text-sm text-red-600">
          שגיאה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-400">
          {deals.length === 0 ? 'אין עדיין עסקאות.' : 'אין תוצאות לסינון.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <Th>עסקה</Th>
                <Th>ארגון</Th>
                <Th>שלב</Th>
                <Th>שווי</Th>
                <Th>סטטוס</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <Td>
                    <Link
                      to={`/admin/deals/${d.id}`}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      {d.title}
                    </Link>
                    <span className="text-gray-400 text-[11px] block">
                      {d._count?.contacts ?? 0} אנשי קשר
                    </span>
                  </Td>
                  <Td>{d.organization?.name || <span className="text-gray-400">—</span>}</Td>
                  <Td>
                    <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[12px] text-gray-700">
                      {d.dealStage?.label}
                    </span>
                  </Td>
                  <Td className="font-medium tabular-nums" dir="ltr">
                    {formatMinor(d.valueMinor, d.currency)}
                  </Td>
                  <Td>
                    <StatusChip status={d.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        DEAL_STATUS_STYLES[status] || ''
      }`}
    >
      {DEAL_STATUS_LABELS[status] || status}
    </span>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
function Th({ children }) {
  return (
    <th className="text-right text-[11px] uppercase tracking-wide font-semibold px-4 py-2.5">
      {children}
    </th>
  );
}
function Td({ children, className = '', dir }) {
  return (
    <td className={`px-4 py-3 ${className}`} dir={dir}>
      {children}
    </td>
  );
}
