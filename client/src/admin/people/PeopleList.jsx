import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
// VAT_OPTIONS feeds the inline VAT editor + the bulk-edit dialog; VAT_LABELS
// renders the read-only column. ONE canonical export (people/config.js).
import { PERSON_STATUS_LABELS, PERSON_STATUSES, VAT_LABELS, VAT_OPTIONS } from './config.js';
import { StaffAvatar } from '../tours/TourTeamEditor.jsx';
import {
  useTableColumns,
  ColumnPicker,
  SortableHeaderRow,
  TableCell,
} from '../common/tableColumns.jsx';
import StaffColorPicker, { StaffColorSwatch } from '../../color/StaffColorPicker.jsx';
import { rowTintStyle } from '../../color/staffColorUi.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';

// Column definitions — the shared tableColumns infra owns visibility, order
// and persistence (localStorage per table per browser profile — the app's
// standard personal-preference layer, so every manager keeps their own
// layout). `def` marks the default-visible set; the payroll columns exist
// but start hidden. New columns added here appear in the picker automatically.
const STAFF_COLUMNS = [
  { key: 'name', label: 'שם', def: true },
  { key: 'color', label: 'צבע', def: true, align: 'center' },
  { key: 'phone', label: 'טלפון', def: true },
  { key: 'email', label: 'אימייל', def: true, cls: 'max-w-[180px]' },
  { key: 'team', label: 'צוות', def: true },
  { key: 'status', label: 'סטטוס', def: true },
  { key: 'tours', label: 'סיורים', def: true, align: 'center' },
  { key: 'training', label: 'מערכי הדרכה', def: true },
  { key: 'trainingStart', label: 'תחילת הדרכה', def: true },
  { key: 'trainingCohort', label: 'מחזור הכשרה', def: true },
  { key: 'vat', label: 'מע״מ' },
  { key: 'seniority', label: 'תוספת ותק' },
  { key: 'travel', label: 'נסיעות' },
];

// Unified "אנשים וגישה" surface.
//
// Architectural intent (see audit + spec):
//   * One identity layer (PersonRef) for everyone — trainee / staff /
//     evaluator are lifecycle hints, not separate person types.
//   * Recruitment is the upstream source of truth for lifecycle.
//     GOS owns access (portalEnabled + audit timestamps).
//   * No separate tabs per role. Two filter dimensions instead:
//     lifecycle and access state.
//
// The previous "מדריכים" header + columns are gone. Same DB-level
// data, same upstream sync, same per-person profile route — only the
// admin surface evolved.

// Lifecycle stays a FILTER dimension (and lives in the three-dot menu); the
// table itself no longer carries a "type" column — the roster reads by
// person, not by classification. There is intentionally NO 'rejected' —
// rejected trainees are deleted, not stored.
const LIFECYCLE_FILTERS = [
  { key: 'all', label: 'פעילים' }, // active roster (trainee + staff); former hidden
  { key: 'trainee', label: 'מתלמדים' },
  { key: 'staff', label: 'צוות' },
  { key: 'former', label: 'עזבו' },
  { key: 'unknown', label: 'ללא סיווג' },
];

const ACCESS_FILTERS = [
  { key: 'all', label: 'כולם' },
  { key: 'granted', label: 'יש גישה' },
  { key: 'revoked', label: 'אין גישה' },
];

export default function PeopleList() {
  const [people, setPeople] = useState([]);
  const [upstream, setUpstream] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const cols = useTableColumns('people.columns', STAFF_COLUMNS);
  // Teams feed the inline team editor (same list the profile uses).
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    api.teams
      .list()
      .then((t) => setTeams(t || []))
      .catch(() => setTeams([]));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.people.list();
      setPeople(r.people || []);
      setUpstream(r.upstream || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function forceRefresh() {
    setRefreshing(true);
    try {
      await api.people.forceRefresh();
      await refresh();
    } catch (e) {
      console.warn('force refresh failed:', e.message);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (lifecycleFilter === 'all') {
        // Default "active roster" view hides former staff (עזב).
        if (p.lifecycleHint === 'former') return false;
      } else if (lifecycleFilter === 'unknown') {
        if (p.lifecycleHint) return false;
      } else {
        if (p.lifecycleHint !== lifecycleFilter) return false;
      }
      if (accessFilter === 'granted' && !p.portalEnabled) return false;
      if (accessFilter === 'revoked' && p.portalEnabled) return false;
      if (q) {
        const hay = [
          p.displayName,
          p.email,
          p.phone,
          p.externalPersonId,
          p.team?.displayName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [people, search, lifecycleFilter, accessFilter]);

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">צוות</h1>
          <div className="text-[12.5px] text-gray-500">
            {people.length === 1 ? 'איש צוות אחד' : `${people.length} אנשי צוות`}
          </div>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון או אימייל…"
            className="w-64 rounded-xl border border-gray-300 py-2 pe-9 ps-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-gray-400" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4-4" />
            </svg>
          </span>
        </div>
        <ColumnPicker
          columns={cols.orderedColumns}
          colKeys={cols.colKeys}
          onToggle={cols.toggleCol}
          onMove={cols.moveCol}
          onReset={cols.resetCols}
        />
        <button
          onClick={forceRefresh}
          disabled={refreshing || loading}
          title="רענון מיידי מול מערכת הגיוס"
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-[12.5px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? 'מרענן…' : '⟳ רענון'}
        </button>
      </div>

      <UpstreamStatus upstream={upstream} />

      {/* Filter chips. Two dimensions, both narrowing — lifecycle
          (from upstream) and access state (local GOS truth). No tabs:
          the same row can be a trainee with access OR a staff member
          without access; both shapes exist concurrently. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-[12px]">
        <FilterRow
          label="סוג"
          options={LIFECYCLE_FILTERS}
          value={lifecycleFilter}
          onChange={setLifecycleFilter}
        />
        <FilterRow
          label="גישה"
          options={ACCESS_FILTERS}
          value={accessFilter}
          onChange={setAccessFilter}
        />
      </div>

      {loading && (
        <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
      )}
      {error && (
        <div className="p-6 text-center">
          <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
          <div className="text-xs text-gray-500 font-mono" dir="ltr">
            {error}
          </div>
          <button
            onClick={refresh}
            className="mt-3 border border-gray-300 rounded px-3 py-1 text-sm"
          >
            נסו שוב
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="p-10 text-center text-sm text-gray-500">
          {people.length === 0
            ? upstream?.ok === false
              ? 'לא ניתן לטעון אנשים ממערכת הגיוס. ראו הודעת השגיאה למעלה.'
              : 'אין אנשים במערכת הגיוס.'
            : 'לא נמצאו תוצאות.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <PeopleTable people={filtered} cols={cols} teams={teams} onChanged={refresh} />
      )}
    </div>
  );
}

// ── Bulk edit — one action, many staff members ──────────────────────────────
// Each field opts in with its עדכון checkbox (enabled + empty = clear). The
// apply loop calls the SAME per-person endpoints as inline/profile editing,
// so every affected profile gets its own immutable history entry.

const BULK_FIELDS = [
  { key: 'vatStatus', label: 'מע״מ', type: 'select' },
  { key: 'senioritySupplement', label: 'תוספת ותק', type: 'number' },
  { key: 'travelAllowance', label: 'נסיעות', type: 'number' },
  { key: 'trainingCohort', label: 'מחזור הכשרה', type: 'text' },
  { key: 'teamRefId', label: 'צוות', type: 'team' },
  { key: 'displayColor', label: 'צבע', type: 'color' },
];

function BulkEditDialog({ people, teams, onClose, onDone }) {
  const [enabled, setEnabled] = useState({});
  const [values, setValues] = useState({});
  const [progress, setProgress] = useState(null); // { done, total }
  const [failures, setFailures] = useState([]);

  const anyEnabled = BULK_FIELDS.some((f) => enabled[f.key]);

  async function apply() {
    // Validate the numeric fields once, up front.
    for (const f of BULK_FIELDS) {
      if (!enabled[f.key] || f.type !== 'number') continue;
      const v = String(values[f.key] ?? '').trim();
      if (v && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        window.alert(`${f.label}: מספר אפס או חיובי בלבד.`);
        return;
      }
    }
    const profilePatch = {};
    let teamPatch;
    for (const f of BULK_FIELDS) {
      if (!enabled[f.key]) continue;
      const raw = String(values[f.key] ?? '').trim();
      if (f.key === 'teamRefId') teamPatch = { teamRefId: raw || null };
      else profilePatch[f.key] = raw || null;
    }
    const fails = [];
    setProgress({ done: 0, total: people.length });
    for (let i = 0; i < people.length; i += 1) {
      const p = people[i];
      try {
        if (Object.keys(profilePatch).length > 0) {
          await api.people.updateProfile(p.id, profilePatch);
        }
        if (teamPatch) await api.people.update(p.id, teamPatch);
      } catch (e) {
        fails.push(`${p.displayName}: ${e.payload?.error || e.message}`);
      }
      setProgress({ done: i + 1, total: people.length });
    }
    setFailures(fails);
    if (fails.length === 0) onDone();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      dir="rtl"
      onClick={progress ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-[16px] font-bold text-gray-900">עריכה קבוצתית</h2>
        <p className="mb-4 text-[12.5px] text-gray-500">
          {people.length === 1 ? 'איש צוות אחד נבחר' : `${people.length} אנשי צוות נבחרו`} · רק
          שדות מסומנים יעודכנו; שדה מסומן וריק — ינוקה.
        </p>

        <div className="space-y-2.5">
          {BULK_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={!!enabled[f.key]}
                onChange={(e) => setEnabled((s) => ({ ...s, [f.key]: e.target.checked }))}
                className="accent-blue-600"
                aria-label={`עדכון ${f.label}`}
              />
              <span className="w-24 shrink-0 text-[13px] font-medium text-gray-700">{f.label}</span>
              {f.type === 'color' ? (
                // Shared canonical picker — enabled + "ללא צבע" clears.
                <div className={`flex-1 ${enabled[f.key] ? '' : 'pointer-events-none opacity-40'}`}>
                  <div className="flex items-center gap-2">
                    <StaffColorSwatch colorKey={values[f.key] || null} className="h-6 w-6" />
                    <StaffColorPicker
                      compact
                      value={values[f.key] || null}
                      onPick={(key) => setValues((s) => ({ ...s, [f.key]: key || '' }))}
                    />
                  </div>
                </div>
              ) : f.type === 'select' || f.type === 'team' ? (
                <select
                  disabled={!enabled[f.key]}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                >
                  {(f.type === 'team'
                    ? [{ value: '', label: '—' }, ...teams.map((t) => ({ value: t.id, label: t.displayName }))]
                    : VAT_OPTIONS
                  ).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  {...(f.type === 'number' ? { min: 0, step: 0.01, dir: 'ltr' } : {})}
                  disabled={!enabled[f.key]}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                />
              )}
            </div>
          ))}
        </div>

        {progress && (
          <div className="mt-4 text-[12.5px] text-gray-600">
            מעדכן {progress.done}/{progress.total}…
          </div>
        )}
        {failures.length > 0 && (
          <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-[12px] text-red-700">
            {failures.map((f, i) => (
              <div key={i}>{f}</div>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={failures.length > 0 ? onDone : onClose}
            disabled={!!progress && progress.done < progress.total}
            className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            {failures.length > 0 ? 'סגירה' : 'ביטול'}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!anyEnabled || !!progress}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            עדכון {people.length === 1 ? '' : `${people.length} אנשים`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── the operational table ───────────────────────────────────────────────────
// Human-first: avatar + name lead every row; numbers and dates stay compact;
// the three-dot menu (unchanged behavior) is the only action. Client-side
// pagination — the roster is small and already fully loaded.

const PAGE_SIZES = [10, 25, 50];

function PeopleTable({ people, cols, teams, onChanged }) {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const pages = Math.max(1, Math.ceil(people.length / pageSize));
  const safePage = Math.min(page, pages);
  const rows = people.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1); // filters/search changed the underlying list
    setSelected(new Set()); // stale selection must not survive a re-filter
  }, [people]);

  const allSelected = people.length > 0 && people.every((p) => selected.has(p.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(people.map((p) => p.id)));
  }
  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectedPeople = people.filter((p) => selected.has(p.id));

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Selection bar — appears once anything is checked. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 border-b border-blue-100 bg-blue-50/70 px-4 py-2 text-[13px]">
          <span className="font-semibold text-blue-900">
            {selected.size === 1 ? 'אחד נבחר' : `${selected.size} נבחרו`}
          </span>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700"
          >
            עריכה קבוצתית
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[12.5px] text-gray-500 hover:text-gray-800"
          >
            ניקוי בחירה
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/70 text-gray-500">
            {/* Shared drag-reorderable header (RTL-correct rects). The
                selection checkbox leads; the ⋮ spacer trails. */}
            <SortableHeaderRow
              cols={cols.visibleCols}
              onMove={cols.moveCol}
              leading={
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-blue-600"
                    aria-label="בחירת כולם"
                  />
                </th>
              }
            >
              <th aria-label="פעולות" />
            </SortableHeaderRow>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                visibleCols={cols.visibleCols}
                teams={teams}
                selected={selected.has(p.id)}
                onToggleSelect={() => toggleOne(p.id)}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>

      {bulkOpen && (
        <BulkEditDialog
          people={selectedPeople}
          teams={teams}
          onClose={() => setBulkOpen(false)}
          onDone={async () => {
            setBulkOpen(false);
            setSelected(new Set());
            await onChanged();
          }}
        />
      )}

      {(people.length > PAGE_SIZES[0] || pages > 1) && (
        <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-2.5 text-[12.5px] text-gray-600">
          <label className="flex items-center gap-1.5">
            לשורה
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-1.5 py-1"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          <div className="flex items-center gap-1" dir="ltr">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              className="h-7 w-7 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
              aria-label="עמוד קודם"
            >
              ‹
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                className={`h-7 min-w-7 rounded-lg px-1.5 tabular-nums ${
                  n === safePage
                    ? 'bg-blue-600 font-semibold text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={safePage >= pages}
              onClick={() => setPage(safePage + 1)}
              className="h-7 w-7 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
              aria-label="עמוד הבא"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// "12.03.2024" from the stored YYYY-MM-DD.
function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd || null;
}

// Compact training-content summary — "כמה חומר הדרכה פתוח למדריך הזה?"
// without listing stations: station count + distinct training tours.
function TrainingSummary({ stations, tours }) {
  if (!stations) return <Muted>—</Muted>;
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-gray-800">{stations}</span>
      <span className="text-gray-500"> תחנות</span>
      {tours > 1 && <span className="text-[11.5px] text-gray-400"> · {tours} מערכים</span>}
    </span>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-500">{label}:</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`px-2.5 py-1 rounded-full border text-[12px] transition-colors ${
              value === o.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UpstreamStatus({ upstream }) {
  if (!upstream) return null;
  if (upstream.ok) {
    return (
      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3">
        רשימת האנשים נטענת ישירות ממערכת הגיוס. סיווג (מתלמד / צוות /
        מעריך) הוא הלקסיקון של מערכת הגיוס. הגישה לפורטל היא נפרדת
        לחלוטין — מנוהלת כאן.
      </div>
    );
  }
  return (
    <div className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
      <div className="font-semibold mb-1">
        לא ניתן לסנכרן עם מערכת הגיוס כרגע.
      </div>
      <div>
        מוצג מידע מקומי אחרון. סיבה:{' '}
        <span className="font-mono" dir="ltr">
          {upstream.error}
          {upstream.detail ? ` — ${upstream.detail}` : ''}
        </span>
      </div>
    </div>
  );
}

// ── Inline editing ──────────────────────────────────────────────────────────
// Operational fields edit straight from the table: click → editor → autosave
// on blur/Enter (Escape cancels) → small ✓ flash. Saves go through the SAME
// endpoints the profile uses (updateProfile / update), so validation and the
// immutable changelog are identical — no second editor or history pipeline.
// Status is deliberately NOT inline-editable (lifecycle transitions carry
// business events — accept-to-team confirms, recruitment writes — that need
// the explicit menu/profile flows).

const INLINE_FIELDS = {
  vat: {
    type: 'select',
    get: (p) => p.profile?.vatStatus || '',
    save: (p, v) => api.people.updateProfile(p.id, { vatStatus: v || null }),
  },
  seniority: {
    type: 'number',
    get: (p) =>
      p.profile?.senioritySupplement == null ? '' : String(p.profile.senioritySupplement),
    save: (p, v) => api.people.updateProfile(p.id, { senioritySupplement: v === '' ? null : v }),
  },
  travel: {
    type: 'number',
    get: (p) => (p.profile?.travelAllowance == null ? '' : String(p.profile.travelAllowance)),
    save: (p, v) => api.people.updateProfile(p.id, { travelAllowance: v === '' ? null : v }),
  },
  trainingStart: {
    type: 'date',
    get: (p) => p.profile?.trainingStartDate || '',
    save: (p, v) => api.people.updateProfile(p.id, { trainingStartDate: v || null }),
  },
  trainingCohort: {
    type: 'text',
    get: (p) => p.profile?.trainingCohort || '',
    save: (p, v) => api.people.updateProfile(p.id, { trainingCohort: v || null }),
  },
  team: {
    type: 'team',
    get: (p) => p.teamRefId || '',
    save: (p, v) => api.people.update(p.id, { teamRefId: v || null }),
  },
  // The SAME shared picker as the profile editor — clicking the swatch opens
  // it in a small popover; picking saves immediately.
  color: {
    type: 'color',
    get: (p) => p.profile?.displayColor || '',
    save: (p, v) => api.people.updateProfile(p.id, { displayColor: v || null }),
  },
};

const INLINE_ERROR_MESSAGES = {
  invalid_vat_status: 'ערך מע״מ לא חוקי',
  invalid_seniority_supplement: 'מספר אפס או חיובי בלבד',
  invalid_travel_allowance: 'מספר אפס או חיובי בלבד',
  invalid_training_start_date: 'תאריך לא תקין',
};

function InlineCell({ person, colKey, teams, onChanged, children }) {
  const field = INLINE_FIELDS[colKey];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState(null);
  const cancelled = useRef(false);
  const anchorRef = useRef(null); // the color popover anchors to the cell trigger

  function begin() {
    setValue(field.get(person));
    setError(null);
    cancelled.current = false;
    setEditing(true);
  }

  // Color flow commits an explicit picked value (no blur-input involved).
  async function commitValue(next) {
    setEditing(false);
    if (next === field.get(person)) return;
    setSaving(true);
    try {
      await field.save(person, next);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      await onChanged();
    } catch (e) {
      setError(INLINE_ERROR_MESSAGES[e.payload?.error] || 'השמירה נכשלה');
      setTimeout(() => setError(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function commit() {
    if (cancelled.current) return;
    setEditing(false);
    const next = typeof value === 'string' ? value.trim() : value;
    if (next === field.get(person)) return; // untouched
    if (field.type === 'number' && next !== '' && (!Number.isFinite(Number(next)) || Number(next) < 0)) {
      setError('מספר אפס או חיובי בלבד');
      setTimeout(() => setError(null), 2500);
      return; // previous value stays — nothing was sent
    }
    setSaving(true);
    try {
      await field.save(person, next);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      await onChanged();
    } catch (e) {
      // Validation failure → previous value is restored (we never applied
      // it locally) + a short inline error.
      setError(INLINE_ERROR_MESSAGES[e.payload?.error] || 'השמירה נכשלה');
      setTimeout(() => setError(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (editing && field.type !== 'color') {
    const commonProps = {
      autoFocus: true,
      value,
      onChange: (e) => setValue(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setEditing(false);
        }
      },
      className:
        'w-full min-w-[7rem] rounded-md border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white',
    };
    if (field.type === 'select' || field.type === 'team') {
      const options =
        field.type === 'team'
          ? [{ value: '', label: '—' }, ...teams.map((t) => ({ value: t.id, label: t.displayName }))]
          : VAT_OPTIONS;
      return (
        <select {...commonProps}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        {...commonProps}
        type={field.type === 'number' ? 'number' : field.type}
        {...(field.type === 'number' ? { min: 0, step: 0.01, inputMode: 'decimal', dir: 'ltr' } : {})}
      />
    );
  }

  const trigger = (
    <button
      ref={anchorRef}
      type="button"
      onClick={begin}
      disabled={saving}
      title="לחיצה לעריכה"
      className={`group/edit -mx-1 flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-right hover:bg-blue-50/60 ${
        error ? 'ring-1 ring-red-300' : ''
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {saving ? (
        <span className="shrink-0 text-[11px] text-gray-400">שומר…</span>
      ) : flash ? (
        <span className="shrink-0 text-[11px] font-semibold text-emerald-600">✓ נשמר</span>
      ) : error ? (
        <span className="shrink-0 text-[11px] text-red-600">{error}</span>
      ) : (
        <span className="shrink-0 text-gray-300 opacity-0 transition group-hover/edit:opacity-100" aria-hidden>
          ✎
        </span>
      )}
    </button>
  );

  if (field.type === 'color') {
    // The palette opens through the shared AnchoredMenu — a portal on <body> —
    // so the table card's overflow-hidden / overflow-x-auto can never clip it.
    // Flip-above, viewport clamping, scroll/resize tracking, Escape and
    // outside-click all come from the one shared implementation.
    return (
      <>
        {trigger}
        <AnchoredMenu
          anchorRef={anchorRef}
          open={editing}
          onClose={() => setEditing(false)}
          width={282}
          align="end"
        >
          <div className="p-3">
            <StaffColorPicker
              compact
              value={field.get(person) || null}
              onPick={(key) => commitValue(key || '')}
            />
          </div>
        </AnchoredMenu>
      </>
    );
  }

  return trigger;
}

// One cell per column key — the render side of STAFF_COLUMNS. Adding a
// column = one entry here + one definition above; the picker, ordering and
// persistence come from the shared infra automatically.
function renderCell(key, person) {
  switch (key) {
    case 'color':
      return (
        <StaffColorSwatch
          colorKey={person.profile?.displayColor || null}
          className="mx-auto h-6 w-6"
        />
      );
    case 'name':
      // Avatar + name — the row's identity leads (photo, initials fallback:
      // same StaffAvatar the tour surfaces use).
      return (
        <Link to={`/admin/people/${person.id}`} className="group flex items-center gap-2.5">
          <StaffAvatar
            src={person.profile?.imageUrl}
            name={person.displayName}
            className="h-9 w-9"
          />
          <span className="font-semibold text-gray-900 group-hover:text-blue-700">
            {person.displayName}
          </span>
        </Link>
      );
    case 'phone':
      return person.phone ? (
        <span dir="ltr" className="tabular-nums text-gray-600">{person.phone}</span>
      ) : (
        <Muted>—</Muted>
      );
    case 'email':
      return person.email ? (
        <span dir="ltr" className="block truncate text-gray-600" title={person.email}>
          {person.email}
        </span>
      ) : (
        <Muted>—</Muted>
      );
    case 'team':
      return person.team?.displayName || <Muted>—</Muted>;
    case 'status':
      return <StatusChip status={person.status} />;
    case 'tours':
      return person.toursCount > 0 ? (
        <span className="tabular-nums text-gray-800">{person.toursCount}</span>
      ) : (
        <Muted>—</Muted>
      );
    case 'training':
      return <TrainingSummary stations={person.trainingStations} tours={person.trainingTours} />;
    case 'trainingStart':
      return (
        <span className="tabular-nums text-gray-600">
          {fmtDate(person.profile?.trainingStartDate) || <Muted>—</Muted>}
        </span>
      );
    case 'trainingCohort':
      return person.profile?.trainingCohort || <Muted>—</Muted>;
    case 'vat':
      return VAT_LABELS[person.profile?.vatStatus] || <Muted>—</Muted>;
    case 'seniority':
      return person.profile?.senioritySupplement != null ? (
        <span dir="ltr" className="tabular-nums text-gray-700">
          {String(person.profile.senioritySupplement)}
        </span>
      ) : (
        <Muted>—</Muted>
      );
    case 'travel':
      return person.profile?.travelAllowance != null ? (
        <span dir="ltr" className="tabular-nums text-gray-700">
          {String(person.profile.travelAllowance)}
        </span>
      ) : (
        <Muted>—</Muted>
      );
    default:
      return null;
  }
}

function PersonRow({ person, visibleCols, teams, selected, onToggleSelect, onChanged }) {
  // Personal color = subtle full-row tint + saturated start-edge stripe
  // (shared helper). Selection keeps its blue wash — only the stripe stays.
  const tint = rowTintStyle(person.profile?.displayColor);
  const rowStyle = selected ? { boxShadow: tint.boxShadow } : tint;
  return (
    <tr
      style={rowStyle}
      className={`transition-colors ${selected ? 'bg-blue-50/40' : 'hover:bg-gray-50/70'}`}
    >
      <TableCell col={{}} stopClick className="w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="accent-blue-600"
          aria-label={`בחירת ${person.displayName}`}
        />
      </TableCell>
      {visibleCols.map((col) => (
        <TableCell key={col.key} col={col}>
          {INLINE_FIELDS[col.key] ? (
            <InlineCell person={person} colKey={col.key} teams={teams} onChanged={onChanged}>
              {renderCell(col.key, person)}
            </InlineCell>
          ) : (
            renderCell(col.key, person)
          )}
        </TableCell>
      ))}
      <TableCell col={{ align: 'left' }} stopClick>
        <ActionsMenu person={person} onChanged={onChanged} />
      </TableCell>
    </tr>
  );
}

// Compact per-row actions. One 3-dot button opens a menu grouped into clear
// sections so the table stays clean: the guide portal (GOS-native), the
// evaluator/mentor portal (link read-through from recruitment — GOS is the
// user-facing place), and management. No technical terminology.
const LIFECYCLE_MENU = [
  { key: 'trainee', label: 'מתלמד' },
  { key: 'staff', label: 'צוות' },
  { key: 'former', label: 'עזב' },
  { key: 'none', label: 'ללא שיוך' },
];

function ActionsMenu({ person, onChanged }) {
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null); // 'guide' | 'eval' | null

  const guideUrl = `${window.location.origin}/p/${person.portalToken}`;
  const evalUrl = person.evaluatorPortalUrl || null;
  // A mentor/evaluator ("פורטל ממשב") can belong to ANY staff member — whether they
  // came from a guide (guide:<id>) or a candidate who became staff (candidate:<id>).
  // Trainees / former / unassigned truly cannot have one.
  const canHaveEvaluator = person.lifecycleHint === 'staff';
  const currentLifecycle = person.lifecycleHint || 'none';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-actions-menu]')) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = 288;
      const left = Math.max(8, r.right - width);
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const openUp = spaceBelow < 380 && spaceAbove > spaceBelow;
      setPos({
        left,
        top: openUp ? undefined : r.bottom + 6,
        bottom: openUp ? window.innerHeight - r.top + 6 : undefined,
        maxHeight: (openUp ? spaceAbove : spaceBelow) - 16,
      });
    }
    setOpen((o) => !o);
  }

  function copy(url, which) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      window.alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function regenGuide() {
    if (!window.confirm('ליצור קישור פורטל מדריך חדש? הקישור הנוכחי יפסיק לעבוד מיידית.')) return;
    await run(() => api.people.rotateToken(person.id));
  }

  async function regenEval() {
    // Regenerate replaces an existing link (needs a heads-up); creating a first
    // link does not. Both use the same GOS→recruitment rotate endpoint.
    if (evalUrl && !window.confirm('ליצור קישור פורטל ממשב חדש? הקישור הנוכחי יפסיק לעבוד מיידית.')) return;
    await run(() => api.people.rotateEvaluatorToken(person.id));
  }

  async function setLifecycle(value) {
    if (value === currentLifecycle) { setOpen(false); return; }
    // trainee → צוות is the official acceptance business event (with confirm).
    if (person.lifecycleHint === 'trainee' && value === 'staff') {
      if (!window.confirm('המתלמד יתקבל באופן רשמי לצוות. הפעולה תירשם במערכת הגיוס ותהפוך אותו לחבר צוות. להמשיך?')) return;
      await run(() => api.people.acceptToTeam(person.id));
      return;
    }
    await run(() => api.people.setLifecycle(person.id, value));
  }

  async function toggleAccess() {
    await run(() => api.people.setAccess(person.id, !person.portalEnabled));
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 ${
          open ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200'
        }`}
        title="פעולות"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="text-lg leading-none">⋮</span>
      </button>

      {open && (
        <div
          data-actions-menu
          dir="rtl"
          className="fixed z-50 w-72 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight }}
        >
          <MenuSection title="פורטל מדריך">
            <ActionRow icon={<IconNew />} onClick={regenGuide} disabled={busy}>יצירת קישור חדש</ActionRow>
            <ActionRow icon={<IconCopy />} onClick={() => copy(guideUrl, 'guide')}>
              {copied === 'guide' ? 'הקישור הועתק' : 'העתקת קישור'}
            </ActionRow>
            <ActionRow icon={<IconOpen />} onClick={() => { window.open(guideUrl, '_blank', 'noopener'); setOpen(false); }}>
              פתיחת פורטל
            </ActionRow>
          </MenuSection>

          <MenuSection title="פורטל ממשב">
            {evalUrl ? (
              <>
                <ActionRow icon={<IconNew />} onClick={regenEval} disabled={busy}>יצירת קישור חדש</ActionRow>
                <ActionRow icon={<IconCopy />} onClick={() => copy(evalUrl, 'eval')}>
                  {copied === 'eval' ? 'הקישור הועתק' : 'העתקת קישור'}
                </ActionRow>
                <ActionRow icon={<IconOpen />} onClick={() => { window.open(evalUrl, '_blank', 'noopener'); setOpen(false); }}>
                  פתיחת פורטל ממשב
                </ActionRow>
              </>
            ) : canHaveEvaluator ? (
              <ActionRow icon={<IconNew />} onClick={regenEval} disabled={busy}>יצירת קישור ממשב</ActionRow>
            ) : (
              <div className="flex items-center gap-3 px-2.5 py-2 text-[13px] text-gray-400">
                <span className="flex-1 text-right">אין פורטל ממשב</span>
                <span className="shrink-0 text-gray-300"><IconOpen /></span>
              </div>
            )}
          </MenuSection>

          <MenuSection title="ניהול">
            <ActionRow icon={<IconCard />} variant="link" onClick={() => { setOpen(false); navigate(`/admin/people/${person.id}`); }}>
              פתיחת כרטיס ניהול
            </ActionRow>
          </MenuSection>

          <MenuSection title="שינוי סטטוס">
            <div className="flex flex-wrap gap-1.5 px-2 py-1">
              {LIFECYCLE_MENU.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy}
                  onClick={() => setLifecycle(o.key)}
                  className={`rounded-lg px-3 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
                    o.key === currentLifecycle
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </MenuSection>

          <div className="mt-1.5 border-t border-gray-100 pt-1.5">
            {person.portalEnabled ? (
              <ActionRow icon={<IconRevoke />} variant="danger" onClick={toggleAccess} disabled={busy}>
                ביטול גישה
              </ActionRow>
            ) : (
              <ActionRow icon={<IconGrant />} variant="success" onClick={toggleAccess} disabled={busy}>
                מתן גישה
              </ActionRow>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Menu presentation ───────────────────────────────────────────────────────
// A calm, scannable command menu. Section titles read like chapter headings
// (GOS blue, semibold, underlined); rows are quiet with a muted icon on the
// leading (left, RTL) edge and a soft hover. One consistent line-icon family.

function MenuSection({ title, children }) {
  return (
    <div className="pt-2.5 first:pt-1">
      <div className="mb-1 border-b border-gray-100 px-2.5 pb-1.5 text-right text-[13px] font-semibold text-blue-700">
        {title}
      </div>
      {children}
    </div>
  );
}

const ROW_VARIANTS = {
  default: { row: 'text-gray-700 hover:bg-gray-50', icon: 'text-gray-400' },
  link: { row: 'text-blue-700 hover:bg-blue-50', icon: 'text-blue-500' },
  danger: { row: 'text-red-600 hover:bg-red-50', icon: 'text-red-500' },
  success: { row: 'text-emerald-700 hover:bg-emerald-50', icon: 'text-emerald-500' },
};

function ActionRow({ icon, children, onClick, disabled, variant = 'default' }) {
  const v = ROW_VARIANTS[variant] || ROW_VARIANTS.default;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-[14px] transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${v.row}`}
    >
      <span className="flex-1 text-right">{children}</span>
      <span className={`shrink-0 ${v.icon}`}>{icon}</span>
    </button>
  );
}

// One consistent 17px line-icon family (stroke = currentColor, so each row's
// variant colours its own icon).
const SVG = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
function IconNew() {
  return <svg {...SVG}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>;
}
function IconCopy() {
  return <svg {...SVG}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
}
function IconOpen() {
  return <svg {...SVG}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /></svg>;
}
function IconCard() {
  return <svg {...SVG}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="10" r="2" /><path d="M6 16c.4-1.2 1.4-2 2.5-2s2.1.8 2.5 2" /><line x1="14" y1="9.5" x2="18" y2="9.5" /><line x1="14" y1="13.5" x2="18" y2="13.5" /></svg>;
}
function IconRevoke() {
  return <svg {...SVG}><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>;
}
function IconGrant() {
  return <svg {...SVG}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4 4.6-4.8" /></svg>;
}

function Muted({ children }) {
  return <span className="text-gray-400">{children}</span>;
}

function StatusChip({ status }) {
  const active = status === PERSON_STATUSES.ACTIVE;
  return (
    <span
      className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded ${
        active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {PERSON_STATUS_LABELS[status] || status}
    </span>
  );
}
