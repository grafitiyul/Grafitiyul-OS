import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Dialog from '../common/Dialog.jsx';

// Products catalog (Settings → CRM → Products). Premium UI pass — data model,
// routes, and business logic are unchanged; this is presentation only.
//
// Business invariant (unchanged): a product always exists in variants by
// location, so creation requires an initial location (backend creates both
// atomically). Removal is a reversible Archive (active=false) — never hard-delete
// from the UI. Archived products are muted, badged, and restorable.
//
// Note: the products list API returns only { nameHe, nameEn, active,
// _count.variants }. There is no product image field (so the thumbnail is a
// monogram avatar) and no per-product location list (so filtering by location is
// not available here without an API change — intentionally left out).

export default function ProductsSettings() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [products, locs] = await Promise.all([api.products.list(), api.locations.list()]);
      setRows(products);
      setLocations(locs);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const hasLocations = locations.length > 0;
  const activeCount = rows.filter((p) => p.active).length;
  const archivedCount = rows.length - activeCount;

  const matchesSearch = (p) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (p.nameHe || '').toLowerCase().includes(s) || (p.nameEn || '').toLowerCase().includes(s);
  };
  const shown = rows.filter((p) => (showArchived || p.active) && matchesSearch(p));

  async function createProduct() {
    if (!nameHe.trim() || !locationId) return;
    setBusy(true);
    try {
      const p = await api.products.create({ nameHe: nameHe.trim(), locationId });
      setNameHe('');
      setLocationId('');
      setShowCreate(false);
      navigate(`/admin/settings/crm/products/${p.id}`);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(product, active) {
    try {
      await api.products.update(product.id, { active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }
  function archive(product) {
    if (confirm(`להעביר את "${product.nameHe}" לארכיון? המוצר יוסתר מהרשימות הפעילות אך יישמר במלואו וניתן לשחזר בכל עת.`)) {
      setActive(product, false);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-5xl mx-auto">
      {/* Header */}
      <SettingsChrome />
      <header className="mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900">מוצרים</h1>
          <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed max-w-xl">
            קטלוג המוצרים שאנו מוכרים. כל מוצר מתקיים בגרסאות לפי מיקום.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition"
        >
          <PlusIcon /> מוצר חדש
        </button>
      </header>

      {/* Filter bar — a flexible horizontal row. A Location filter <select> can be
          dropped in here (e.g. right after the search) with no layout changes once
          the products API exposes per-product locations; nothing else needs to move. */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute inset-y-0 right-3 flex items-center text-gray-400 pointer-events-none"><SearchIcon /></span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש מוצר…"
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pr-9 pl-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          />
        </div>
        {/* Location filter placeholder — future: <LocationFilter /> goes here. */}
        <button
          onClick={() => setShowArchived((s) => !s)}
          className={`h-10 inline-flex items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium shadow-sm transition ${
            showArchived
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <ArchiveIcon />
          {showArchived ? 'מציג ארכיון' : 'הצג ארכיון'}
          {archivedCount > 0 && (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">{archivedCount}</span>
          )}
        </button>
      </div>

      {/* Summary strip */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-gray-100 bg-gray-50/50 px-5 py-3">
        <Stat icon="📦" label="סה״כ מוצרים" value={rows.length} />
        <Divider />
        <Stat icon="📍" label="סה״כ מיקומים" value={locations.length} />
        <Divider />
        <Stat icon="✅" label="מוצרים פעילים" value={activeCount} />
        <Divider />
        <Stat icon="🗂️" label="בארכיון" value={archivedCount} />
      </div>

      {/* Table */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
        {/* column header */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-b border-gray-100 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          <div className="flex-1">מוצר</div>
          <div className="w-32 text-center">מיקומים</div>
          <div className="w-24 text-center">סטטוס</div>
          <div className="w-12" />
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-red-600">שגיאה: {error}</div>
        ) : shown.length === 0 ? (
          <EmptyState hasAny={rows.length > 0} q={q} onCreate={() => setShowCreate(true)} />
        ) : (
          <ul>
            {shown.map((p) => (
              <li
                key={p.id}
                onClick={() => navigate(`/admin/settings/crm/products/${p.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/admin/settings/crm/products/${p.id}`); } }}
                role="button"
                tabIndex={0}
                aria-label={`פתיחת ${p.nameHe}`}
                className={`group flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-b-0 last:rounded-b-2xl cursor-pointer transition-colors hover:bg-gray-50/70 focus:outline-none focus-visible:bg-gray-50 ${
                  !p.active ? 'opacity-60' : ''
                }`}
              >
                {/* Identity */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <Avatar name={p.nameHe} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[18px] font-semibold text-gray-900 truncate group-hover:text-blue-700 transition-colors">
                        {p.nameHe}
                      </span>
                      {!p.active && (
                        <span className="shrink-0 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-100">
                          בארכיון
                        </span>
                      )}
                    </div>
                    <div className={`text-[14px] truncate ${p.nameEn ? 'text-gray-400' : 'text-gray-300'}`} dir="ltr">
                      {p.nameEn || '—'}
                    </div>
                  </div>
                </div>

                {/* Locations */}
                <div className="w-32 text-center text-[14px] text-gray-600">
                  <span className="inline-flex items-center gap-1">📍 {p._count?.variants ?? 0} מיקומים</span>
                </div>

                {/* Status */}
                <div className="w-24 flex justify-center">
                  {p.active ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> פעיל
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                      בארכיון
                    </span>
                  )}
                </div>

                {/* Actions — only the three-dot menu; stop row navigation on click */}
                <div className="w-12 flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                  <ActionsMenu
                    items={
                      p.active
                        ? [{ label: 'העברה לארכיון', onClick: () => archive(p), tone: 'amber' }]
                        : [{ label: 'שחזור מארכיון', onClick: () => setActive(p, true) }]
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create dialog (reuses the existing create flow: name + initial location) */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="מוצר חדש" size="md">
        {hasLocations ? (
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] text-gray-500 mb-1">שם המוצר (עברית)</label>
              <input
                autoFocus
                value={nameHe}
                onChange={(e) => setNameHe(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProduct(); }}
                placeholder="לדוגמה: סיור וסדנת גרפיטי"
                className="h-10 w-full rounded-xl border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-[12px] text-gray-500 mb-1">מיקום ראשון</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              >
                <option value="">בחרו מיקום…</option>
                {locations.map((l) => (<option key={l.id} value={l.id}>{l.nameHe}</option>))}
              </select>
            </div>
            <p className="text-[11px] text-gray-500">
              מוצר חייב מיקום אחד לפחות כדי להיות שמיש. אפשר להוסיף מיקומים נוספים אחרי היצירה.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} disabled={busy}
                className="h-10 rounded-xl border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                ביטול
              </button>
              <button onClick={createProduct} disabled={busy || !nameHe.trim() || !locationId}
                className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'יוצר…' : 'צור מוצר'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            כדי ליצור מוצר צריך קודם להגדיר לפחות <b>מיקום אחד</b>. מוצר תמיד מתקיים בגרסה לפי מיקום.{' '}
            <Link to="/admin/settings/crm/locations" className="font-medium text-amber-900 underline">להגדרת מיקומים</Link>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function Avatar({ name }) {
  const initial = (name || '').trim().charAt(0) || '📦';
  return (
    <div className="h-11 w-11 shrink-0 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 ring-1 ring-inset ring-gray-200/70 flex items-center justify-center text-[18px] font-semibold text-gray-500 select-none">
      {initial}
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[16px] leading-none">{icon}</span>
      <div className="leading-tight">
        <div className="text-[11px] text-gray-400">{label}</div>
        <div className="text-[16px] font-semibold text-gray-800">{value}</div>
      </div>
    </div>
  );
}
function Divider() {
  return <span className="h-8 w-px bg-gray-200/80" />;
}

function EmptyState({ hasAny, q, onCreate }) {
  if (hasAny) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="text-3xl mb-2">🔍</div>
        <div className="text-sm text-gray-500">{q ? 'לא נמצאו מוצרים תואמים.' : 'אין מוצרים פעילים.'}</div>
      </div>
    );
  }
  return (
    <div className="px-4 py-16 text-center">
      <div className="text-3xl mb-2">📦</div>
      <div className="text-sm text-gray-600 font-medium">עדיין אין מוצרים</div>
      <div className="text-[13px] text-gray-400 mt-1 mb-4">הוסיפו את המוצר הראשון כדי להתחיל.</div>
      <button onClick={onCreate} className="inline-flex items-center gap-1.5 h-9 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
        <PlusIcon /> מוצר חדש
      </button>
    </div>
  );
}

function ActionsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="פעולות"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg z-30">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`block w-full text-right px-3 py-2 text-[13px] hover:bg-gray-50 ${it.tone === 'amber' ? 'text-amber-700' : 'text-gray-700'}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── icons ────────────────────────────────────────────────────────────────────
const ic = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
function PlusIcon() { return (<svg {...ic} aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>); }
function SearchIcon() { return (<svg {...ic} aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>); }
function ArchiveIcon() { return (<svg {...ic} width="15" height="15" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></svg>); }
function DotsIcon() { return (<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>); }
