import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AnchoredMenu from '../../common/AnchoredMenu.jsx';
import { api } from '../../../lib/api.js';
import { hasDirtyForms } from '../../../lib/dirtyForms.js';
import { useRealtime } from '../../../lib/realtime.js';
import { DEAL_TASKS_CHANGED_EVENT } from '../../deals/tasks/taskEvents.js';
import DealDrawer from '../../common/DealDrawer.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import TaskCards from './TaskCards.jsx';
// TaskIcon = the ONE task-icon renderer: whatsapp (by key OR channel) → the
// shared SVG brand mark; everything else → its emoji. Same component the Deal
// task UI uses — one WhatsApp icon source across GOS.
import TaskIcon from '../../deals/tasks/TaskIcon.jsx';
import { dealPath } from '../../deals/config.js';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell, COL_SEP } from '../../common/tableColumns.jsx';
import { toggleSortKey, sortFromParam } from '../../common/tableColumnsCore.js';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';
import { useTourMidnightRefresh } from '../../tours/tourEvents.js';
import { TASK_COLUMNS, COLUMNS_KEY, SORTABLE_KEYS, rowTone, priorityLabel, dueDateOf } from './columns.jsx';
import {
  TIME_CHIPS, defaultFilters, filtersFromParams, filtersToParams, filtersToQuery,
  selectWindow, statusLockedBy, toggleIn, hasActiveFilters, rangeIncomplete,
  loadFilters, saveFilters, hasStoredFilters, resolveViewFilters, portableFilters,
} from './taskFilters.js';

// CRM Tasks WORKSPACE — the first CRM tab and the primary daily operational
// screen. Dense, keyboard-first, inline-edited: the Deal drawer is the only
// sanctioned heavy-detail exception (Slice 3), and popups are a failure mode.
//
// State lives in the URL (deep-linkable) and is mirrored to localStorage so the
// workspace is restored on return. All filter/window semantics come from the
// pure modules — taskFilters.js here, tasks/windows.js on the server — never
// from this component.
//
// Writes: inline edits call the EXISTING deal-scoped task endpoints. Every row
// carries its dealId, so the project keeps ONE task write path (Slice 4
// consolidates it behind taskService when bulk actions arrive).

const PAGE_SIZE = 50;

// Saved Views: TEMPORARILY HIDDEN (owner decision 2026-07-16) while the
// workspace design stabilises. The full infrastructure — server model/routes,
// API client, apply/save/update/delete logic below — stays intact; this flag
// gates only the UI, the boot fetch, and the cross-device last-view restore
// (restoring an invisible view would apply filters with no indicator of why).
// Re-enabling is flipping this to true.
const SHOW_SAVED_VIEWS_UI = false;

// Server error codes → operator Hebrew. Every per-row bulk failure and every
// refused inline edit speaks through this map.
const WRITE_ERRORS = {
  task_not_found: 'המשימה לא נמצאה',
  task_not_open: 'המשימה אינה פתוחה',
  whatsapp_type_locked: 'משימת וואטסאפ מתוזמנת — הסוג נעול',
  type_channel_not_allowed: 'לא ניתן להפוך משימה למשימת וואטסאפ',
  scheduled_not_editable: 'ההודעה המתוזמנת כבר אינה ניתנת לעריכה',
  scheduled_at_past: 'מועד השליחה המתוזמן כבר עבר',
  owner_not_found: 'האחראי לא נמצא',
  invalid_task_type: 'סוג משימה לא קיים',
  nothing_to_update: 'אין מה לעדכן',
  internal: 'שגיאה פנימית',
};
const writeError = (code) => WRITE_ERRORS[code] || code || 'שגיאה';

const CHIP_TONE = {
  primary: 'bg-emerald-600 text-white ring-emerald-600',
  danger: 'bg-red-600 text-white ring-red-600',
  warn: 'bg-amber-500 text-white ring-amber-500',
  plain: 'bg-slate-700 text-white ring-slate-700',
};

// (The multi-chip row is gone — the time filter is now ONE tone-coloured chip
// with an AnchoredMenu; CHIP_TONE colours it and Count renders its badge.)

function Count({ n, active }) {
  if (n == null) return null;
  return (
    <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/25' : 'bg-gray-100 text-gray-500'}`}>
      {n}
    </span>
  );
}

export default function TasksWorkspace() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [boot, setBoot] = useState(null); // { me, types, users, stages }
  const [filters, setFilters] = useState(null);
  const [sort, setSort] = useState(() => {
    const s = sortFromParam(searchParams.get('sort'), SORTABLE_KEYS);
    return s.length ? s : [{ key: 'dueDate', dir: 'asc' }];
  });
  const [page, setPage] = useState(() => Math.max(parseInt(searchParams.get('page'), 10) || 1, 1));
  const [data, setData] = useState({ rows: [], total: 0, truncated: false, empty: false, today: null });
  const [counts, setCounts] = useState({ counts: {}, empty: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(null); // { rowId, colKey }
  const [savingId, setSavingId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState(null); // { action, succeeded, failed:[{id,error}] }
  const [confirmCancel, setConfirmCancel] = useState(false);
  // ── saved views ──
  const [views, setViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState(null);
  const [viewDirty, setViewDirty] = useState(false); // filters changed since the view was applied
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveScope, setSaveScope] = useState('personal');
  const [viewBusy, setViewBusy] = useState(false);
  const [confirmDeleteView, setConfirmDeleteView] = useState(false);
  // ── toolbar chrome ──
  // The CRM tab row's end-side slot (CrmLayout renders it) — workspace-level
  // filters portal there, leaving this component's toolbar to task-level work.
  const [tabRowSlot, setTabRowSlot] = useState(null);
  useEffect(() => setTabRowSlot(document.getElementById('crm-tabrow-slot')), []);
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const timeChipRef = useRef(null);
  // The drawer follows a ROW index, not a deal id: consecutive rows may share a
  // Deal (two tasks on one deal), and prev/next walks the filtered ROW order —
  // deduping would make the position indicator lie.
  const [drawerIdx, setDrawerIdx] = useState(null);
  const [drawerDealId, setDrawerDealId] = useState(null);

  const cols = useTableColumns(COLUMNS_KEY, TASK_COLUMNS);
  const gridRef = useRef(null);
  const lastClickedRow = useRef(null);

  // ── bootstrap: who am I, plus the filter vocabularies ──
  useEffect(() => {
    let alive = true;
    (async () => {
      // taskTypes drive the type chips and are REAL if they fail. The rest are
      // best-effort: a missing owner list degrades a filter, not the screen.
      const [ttRes, usRes, status, stRes, vRes] = await Promise.all([
        api.taskTypes.list(true).catch(() => []),
        api.adminUsers.list().catch(() => ({ users: [] })),
        api.auth.status().catch(() => ({})),
        api.dealStages.list().catch(() => []),
        SHOW_SAVED_VIEWS_UI ? api.savedViews.list('crm_tasks').catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      const types = Array.isArray(ttRes) ? ttRes : ttRes?.taskTypes || [];
      const users = (Array.isArray(usRes) ? usRes : usRes?.users || []).filter((u) => u.isActive);
      const stages = Array.isArray(stRes) ? stRes : stRes?.dealStages || stRes?.stages || [];
      const me = users.find((u) => u.username === status?.username)?.id || null;
      setBoot({ me, types, users, stages });
      setViews(vRes?.views || []);
      // Restore priority: URL (a shared link opens what the sender saw) →
      // this browser's exact last workspace (localStorage) → the user's
      // last-selected VIEW (server state — this is the cross-device restore;
      // it fires precisely when the device has no local memory) → defaults.
      if ([...searchParams.keys()].length) {
        setFilters(filtersFromParams(searchParams, me));
      } else if (!hasStoredFilters() && vRes?.lastSelectedId) {
        const lastView = (vRes.views || []).find((v) => v.id === vRes.lastSelectedId);
        if (lastView) applyView(lastView, me);
        else setFilters(loadFilters(me));
      } else {
        setFilters(loadFilters(me));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── URL + localStorage mirror ──
  useEffect(() => {
    if (!filters) return;
    saveFilters(filters);
    const next = filtersToParams(filters, sort, page);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, page]);

  const query = useMemo(
    () => (filters ? filtersToQuery(filters, sort, page, PAGE_SIZE) : null),
    [filters, sort, page],
  );

  // Row-diff bookkeeping for the realtime animation: rows that ENTER during a
  // silent refetch (same query — an invalidation, not navigation) glow briefly.
  const prevIdsRef = useRef(null);
  const prevQueryRef = useRef(null);
  const [freshIds, setFreshIds] = useState(() => new Set());
  const freshTimerRef = useRef(null);

  const load = useCallback(async (cause = 'user') => {
    if (!filters || rangeIncomplete(filters)) return;
    // A silent (realtime) refetch must not blank the grid with a spinner —
    // rows should update in place, subtly, not flash.
    if (cause !== 'realtime') setLoading(true);
    setError('');
    try {
      // The counts bar deliberately ignores `window` — it varies only that.
      const countsQuery = filtersToQuery({ ...filters, window: 'today' }, [], 1, null);
      const [list, cnt] = await Promise.all([
        api.tasks.list(query),
        api.tasks.counts(countsQuery).catch(() => null),
      ]);
      // Diff by task id, but ONLY when the query is unchanged: entering rows on
      // navigation are expected and must not glow.
      const ids = new Set((list.rows || []).map((r) => r.id));
      if (cause === 'realtime' && prevQueryRef.current === query && prevIdsRef.current) {
        const entering = [...ids].filter((id) => !prevIdsRef.current.has(id));
        if (entering.length) {
          setFreshIds(new Set(entering));
          clearTimeout(freshTimerRef.current);
          freshTimerRef.current = setTimeout(() => setFreshIds(new Set()), 1200);
        }
      }
      prevIdsRef.current = ids;
      prevQueryRef.current = query;
      setData(list);
      if (cnt) setCounts(cnt);
      if (cause !== 'realtime') setCursor(0);
    } catch (e) {
      if (cause !== 'realtime') setError(e.payload?.error || e.message);
    } finally {
      if (cause !== 'realtime') setLoading(false);
    }
  }, [filters, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(freshTimerRef.current), []);

  // The window bounds move at Israel midnight — reuse the ONE existing timer
  // rather than writing a second one.
  useTourMidnightRefresh(() => load());

  // ── live updates ──
  // SSE (shared realtime core — the same one payroll uses): covers OTHER
  // actors — another admin's edit, the WhatsApp worker completing a send.
  // Debounce/backoff/focus-recovery live in the core.
  useRealtime('/api/tasks/stream', () => load('realtime'));
  // Local event bus: instant same-browser echo when a task changes elsewhere
  // in this app (the Deal drawer's task strip, the WhatsApp dock) — no need to
  // wait a debounce round-trip for our own actions.
  useEffect(() => {
    const onChanged = () => load('realtime');
    window.addEventListener(DEAL_TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DEAL_TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

  const rows = data.rows || [];
  const today = data.today;
  const pages = Math.max(Math.ceil((data.total || 0) / PAGE_SIZE), 1);
  const statusLock = filters ? statusLockedBy(filters) : null;

  // ── drawer ──
  // DealDetail is a ~1000-line workspace and remounts per deal (key={dealId}),
  // so holding an arrow key would fire one full load per keypress. Debounce the
  // target: arrowing THROUGH rows is free, and only where you land loads.
  useEffect(() => {
    if (drawerIdx == null) { setDrawerDealId(null); return; }
    const target = rows[drawerIdx]?.deal?.id ?? null;
    if (target === drawerDealId) return;
    const t = setTimeout(() => setDrawerDealId(target), 150);
    return () => clearTimeout(t);
  }, [drawerIdx, rows, drawerDealId]);

  const stepDrawer = useCallback((delta) => {
    setDrawerIdx((i) => {
      if (i == null) return i;
      // Same guard the inboxes use: never abandon a half-typed form.
      if (hasDirtyForms()) return i;
      const next = i + delta;
      if (next < 0 || next >= rows.length) return i;
      setCursor(next);
      return next;
    });
  }, [rows.length]);

  function openDrawer(idx) {
    setDrawerIdx(idx);
    setCursor(idx);
  }

  const patch = (next) => {
    setFilters(next);
    setPage(1);
    setSelected(new Set());
    // A manual change means the workspace has drifted from the applied view —
    // the view stays selected (so "עדכון התצוגה" can capture the drift) but is
    // marked dirty.
    if (selectedViewId) setViewDirty(true);
  };

  // ── saved views ──
  const SORTABLE_SET = useMemo(() => new Set(SORTABLE_KEYS), []);

  function applyView(view, meId = boot?.me) {
    setFilters(resolveViewFilters(view.filters, meId));
    const sortList = (Array.isArray(view.sort) ? view.sort : [])
      .filter((s) => s && SORTABLE_SET.has(s.key))
      .map((s) => ({ key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' }));
    setSort(sortList.length ? sortList : [{ key: 'dueDate', dir: 'asc' }]);
    if (view.columns) cols.applyColumnState(view.columns);
    setSelectedViewId(view.id);
    setViewDirty(false);
    setPage(1);
    setSelected(new Set());
  }

  function selectView(viewId) {
    if (!viewId) {
      setSelectedViewId(null);
      setViewDirty(false);
      api.savedViews.select('crm_tasks', null).catch(() => {});
      return;
    }
    const view = views.find((v) => v.id === viewId);
    if (!view) return;
    applyView(view);
    // Cross-device: remember the selection server-side (best-effort).
    api.savedViews.select('crm_tasks', view.id).catch(() => {});
  }

  const selectedView = views.find((v) => v.id === selectedViewId) || null;

  async function saveNewView() {
    const name = saveName.trim();
    if (!name || viewBusy) return;
    setViewBusy(true);
    setError('');
    try {
      const created = await api.savedViews.create({
        module: 'crm_tasks',
        name,
        scope: saveScope,
        // '$me' portability: a shared view saved as "my tasks" follows whoever
        // opens it, not whoever saved it.
        filters: portableFilters(filters, boot.me),
        sort,
        columns: cols.columnState,
      });
      setViews((list) => [...list, created]);
      setSelectedViewId(created.id);
      setViewDirty(false);
      setSaveOpen(false);
      setSaveName('');
      api.savedViews.select('crm_tasks', created.id).catch(() => {});
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setViewBusy(false);
    }
  }

  async function updateSelectedView() {
    if (!selectedView?.editable || viewBusy) return;
    setViewBusy(true);
    setError('');
    try {
      const updated = await api.savedViews.update(selectedView.id, {
        filters: portableFilters(filters, boot.me),
        sort,
        columns: cols.columnState,
      });
      setViews((list) => list.map((v) => (v.id === updated.id ? updated : v)));
      setViewDirty(false);
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setViewBusy(false);
    }
  }

  async function deleteSelectedView() {
    if (!selectedView?.editable || viewBusy) return;
    setViewBusy(true);
    try {
      await api.savedViews.remove(selectedView.id);
      setViews((list) => list.filter((v) => v.id !== selectedView.id));
      setSelectedViewId(null);
      setViewDirty(false);
      api.savedViews.select('crm_tasks', null).catch(() => {});
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setViewBusy(false);
    }
  }

  function onSort(key, opts) {
    setSort((s) => toggleSortKey(s, key, opts));
    setPage(1);
  }

  // ── selection ──
  const toggleRow = useCallback((id, idx, shift) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClickedRow.current != null) {
        const [a, b] = [lastClickedRow.current, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) if (rows[i]) next.add(rows[i].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      lastClickedRow.current = idx;
      return next;
    });
  }, [rows]);

  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // ── writes: the canonical path (taskService via /api/tasks) ──
  // Single-row complete rides the SAME bulk endpoint with one id, so there is
  // literally one transition code path however a task gets completed.
  async function completeRow(row) {
    if (row.status !== 'open') return;
    setSavingId(row.id);
    try {
      const res = await api.tasks.bulk({ action: 'complete', ids: [row.id] });
      const fail = res.results.find((r) => !r.ok);
      if (fail) setError(writeError(fail.error));
      await load();
    } catch (e) {
      setError(writeError(e.payload?.error) || e.message);
    } finally {
      setSavingId(null);
    }
  }

  async function saveCell(row, data2) {
    setSavingId(row.id);
    try {
      await api.tasks.update(row.id, data2);
      setEditing(null);
      await load();
    } catch (e) {
      setError(writeError(e.payload?.error) || e.message);
      setEditing(null);
    } finally {
      setSavingId(null);
    }
  }

  // ── bulk over the selection ──
  async function runBulk(action, payload = {}) {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await api.tasks.bulk({ action, ids, ...payload });
      const failed = res.results.filter((r) => !r.ok);
      setBulkReport(failed.length ? { action, succeeded: res.succeeded, failed } : null);
      // Failures stay selected so the operator can see and retry exactly them.
      setSelected(new Set(failed.map((f) => f.id)));
      await load();
    } catch (e) {
      setError(writeError(e.payload?.error) || e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  // ── keyboard ──
  useEffect(() => {
    function onKey(e) {
      if (editing) return; // the cell editor owns the keyboard while open
      // While the drawer is open it owns the keyboard (ESC + PgUp/PgDn) — the
      // same deferral both inboxes use.
      if (drawerIdx != null) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const row = rows[cursor];
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      else if (e.key === ' ' && row) { e.preventDefault(); toggleRow(row.id, cursor, e.shiftKey); }
      else if (e.key === 'Enter' && row) { e.preventDefault(); openDrawer(cursor); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(allVisibleSelected ? new Set() : new Set(rows.map((r) => r.id)));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && row) { e.preventDefault(); completeRow(row); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-rowidx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!filters || !boot) {
    return <div className="p-6 text-sm text-gray-400">טוען…</div>;
  }

  function cellContent(col, row) {
    const isEditing = editing?.rowId === row.id && editing?.colKey === col.key;
    if (savingId === row.id && isEditing) {
      // Visible saving state: the cell being written shows it, in place.
      return <span className="animate-pulse text-[12px] text-blue-500">שומר…</span>;
    }
    if (isEditing) {
      return (
        <InlineEditor
          col={col}
          row={row}
          boot={boot}
          onCancel={() => setEditing(null)}
          onSave={(d) => saveCell(row, d)}
          onTransition={(action) => transitionRow(row, action)}
        />
      );
    }
    return col.render(row);
  }

  // Inline-editable columns — the same canonical write path as bulk actions
  // (taskService), per cell:
  //   owner / dueDate / dueTime / priority — ANY status (terminal rows accept
  //     record corrections; the server preserves status/completedAt and writes
  //     the correction audit entry);
  //   taskType — any status, but NEVER on a WhatsApp task (its type is bound
  //     to a real scheduled send; the cell shows a lock, not a silent no-op);
  //   status — OPEN tasks only (complete/cancel are transitions; a terminal
  //     status is final — corrections never reopen a task).
  const INLINE_KEYS = new Set(['priority', 'owner', 'dueDate', 'dueTime', 'taskType', 'status']);
  const canEditCell = (col, row) => {
    if (!INLINE_KEYS.has(col.key)) return false;
    if (col.key === 'status') return row.status === 'open';
    if (col.key === 'taskType') return row.channel !== 'whatsapp';
    return true;
  };

  // Status transitions from the inline status cell — the SAME canonical path
  // as the ✓ button and every bulk action: the bulk endpoint with one id.
  async function transitionRow(row, action) {
    setSavingId(row.id);
    try {
      const res = await api.tasks.bulk({ action, ids: [row.id] });
      const fail = res.results.find((r) => !r.ok);
      if (fail) setError(writeError(fail.error));
      setEditing(null);
      await load();
    } catch (e) {
      setError(writeError(e.payload?.error) || e.message);
      setEditing(null);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50" dir="rtl">
      {/* ── WORKSPACE-LEVEL filters → the CRM tab row (portal) ──
          Owner / stage / open-closed describe whose workspace this is, not
          what task you're filtering — so they live beside the module tabs, on
          the opposite (end) side, and the working toolbar below stays for
          task-level controls. */}
      {tabRowSlot &&
        createPortal(
          <>
            <select
              value={filters.ownerIds[0] || ''}
              onChange={(e) => patch({ ...filters, ownerIds: e.target.value ? [e.target.value] : [] })}
              className="h-7 rounded-md border border-gray-300 bg-white px-1.5 text-[12px] text-gray-700"
            >
              <option value="">כל האחראים</option>
              {boot.users.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName || u.username}{u.id === boot.me ? ' (אני)' : ''}</option>
              ))}
            </select>
            <select
              value={filters.stageIds[0] || ''}
              onChange={(e) => patch({ ...filters, stageIds: e.target.value ? [e.target.value] : [] })}
              className="h-7 rounded-md border border-gray-300 bg-white px-1.5 text-[12px] text-gray-700"
            >
              <option value="">כל השלבים</option>
              {boot.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select
              value={filters.status}
              disabled={!!statusLock}
              // באיחור means open by definition — the control locks rather than
              // offering a combination the server rejects.
              title={statusLock ? 'באיחור מתייחס למשימות פתוחות בלבד' : undefined}
              onChange={(e) => patch({ ...filters, status: e.target.value })}
              className="h-7 rounded-md border border-gray-300 bg-white px-1.5 text-[12px] text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="open">פתוחות</option>
              <option value="completed">הושלמו</option>
              <option value="all">הכול</option>
            </select>
          </>,
          tabRowSlot,
        )}

      {/* ── the working toolbar: ONE calm row ──
          RTL reading order: type icons → gap → time filter → (range fields) →
          priority → clear → … count + columns. The table below is the primary
          workspace; these support it without dominating. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2">
        {/* Task types — icon-only squares; the name lives in the tooltip. */}
        <div className="flex items-center gap-1">
          {boot.types.map((t) => {
            const active = filters.typeKeys.includes(t.key);
            return (
              <button
                key={t.id}
                type="button"
                title={t.nameHe}
                aria-label={t.nameHe}
                aria-pressed={active}
                onClick={() => patch({ ...filters, typeKeys: toggleIn(filters.typeKeys, t.key) })}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px] ring-1 transition ${
                  active
                    ? 'bg-blue-600 ring-blue-600 shadow-sm'
                    : 'bg-white ring-gray-200 opacity-55 grayscale hover:opacity-100 hover:grayscale-0 hover:ring-gray-300'
                }`}
              >
                <TaskIcon name={t.icon} channel={t.channel} size={16} />
              </button>
            );
          })}
        </div>

        <span className="mx-1.5 h-5 w-px bg-gray-200" />

        {/* Time filter — ONE chip showing the current window; the rest live in
            its menu. Same bubble design, same disjoint semantics. */}
        {(() => {
          const current = TIME_CHIPS.find((c) => c.key === filters.window) || TIME_CHIPS[1];
          const n = current.key === 'range' ? null : counts.counts?.[current.key];
          return (
            <>
              <button
                ref={timeChipRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={timeMenuOpen}
                onClick={() => setTimeMenuOpen((o) => !o)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ring-1 shadow-sm transition ${CHIP_TONE[current.tone]}`}
              >
                <span aria-hidden>{current.emoji}</span>
                {current.label}
                <Count n={n} active />
                <span aria-hidden className="text-[9px] opacity-80">▼</span>
              </button>
              <AnchoredMenu anchorRef={timeChipRef} open={timeMenuOpen} onClose={() => setTimeMenuOpen(false)} width={200} align="start">
                {TIME_CHIPS.map((chip) => {
                  const isEmpty = Boolean(counts.empty?.[chip.key]);
                  const cnt = chip.key === 'range' ? null : counts.counts?.[chip.key];
                  const isCurrent = filters.window === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      // "השבוע" has no days at all on Fri/Sat — disabled at 0,
                      // never redefined to overlap another chip.
                      disabled={isEmpty}
                      title={isEmpty ? 'אין ימים בטווח הזה השבוע' : undefined}
                      onClick={() => {
                        setTimeMenuOpen(false);
                        patch(selectWindow(filters, chip.key));
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] ${
                        isEmpty
                          ? 'cursor-not-allowed text-gray-300'
                          : isCurrent
                            ? 'bg-blue-50 font-semibold text-blue-700'
                            : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span aria-hidden>{chip.emoji}</span>
                      <span className="flex-1">{chip.label}</span>
                      {cnt != null && (
                        <span className={`rounded-full px-1.5 text-[10px] font-bold ${isCurrent ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {isEmpty ? 0 : cnt}
                        </span>
                      )}
                    </button>
                  );
                })}
              </AnchoredMenu>
            </>
          );
        })()}
        {filters.window === 'range' && (
          <div className="flex items-center gap-2">
            <div className="w-36"><DateField value={filters.rangeFrom} onChange={(v) => patch({ ...filters, rangeFrom: v })} placeholder="מתאריך" /></div>
            <div className="w-36"><DateField value={filters.rangeTo} onChange={(v) => patch({ ...filters, rangeTo: v })} placeholder="עד תאריך" /></div>
          </div>
        )}

        <span className="mx-1.5 h-5 w-px bg-gray-200" />

        {/* Priority stays here: it filters TASKS (deliberately not in the
            owner's workspace-level list). Search will slot in after it when a
            server-side text filter exists. */}
        <select
          value={filters.priorities[0] || ''}
          onChange={(e) => patch({ ...filters, priorities: e.target.value ? [e.target.value] : [] })}
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-[12px] text-gray-700"
        >
          <option value="">כל העדיפויות</option>
          <option value="high">גבוהה</option>
          <option value="medium">בינונית</option>
          <option value="low">נמוכה</option>
          <option value="none">ללא</option>
        </select>
        {hasActiveFilters(filters) && (
          <button type="button" onClick={() => patch(defaultFilters(boot.me))} className="h-8 rounded-md px-2 text-[12px] text-blue-700 hover:bg-blue-50">
            נקה סינון
          </button>
        )}

        {/* Saved views — infrastructure intact, UI temporarily hidden (see
            SHOW_SAVED_VIEWS_UI above). */}
        {SHOW_SAVED_VIEWS_UI && (
          <>
            <select
              value={selectedViewId || ''}
              onChange={(e) => selectView(e.target.value || null)}
              className={`h-8 max-w-44 rounded-md border px-1.5 text-[12px] ${
                selectedViewId ? 'border-indigo-400 bg-indigo-50 text-indigo-800 font-medium' : 'border-gray-300 bg-white text-gray-700'
              }`}
              title="תצוגות שמורות"
            >
              <option value="">תצוגה שמורה…</option>
              {['system', 'shared', 'personal'].map((scope) => {
                const group = views.filter((v) => v.scope === scope);
                if (!group.length) return null;
                const label = scope === 'system' ? 'מערכת' : scope === 'shared' ? 'משותפות' : 'שלי';
                return (
                  <optgroup key={scope} label={label}>
                    {group.map((v) => (
                      <option key={v.id} value={v.id}>{v.icon ? `${v.icon} ` : ''}{v.name}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {selectedView?.editable && viewDirty && (
              <button
                type="button"
                disabled={viewBusy}
                onClick={updateSelectedView}
                title="שמירת הסינון הנוכחי לתוך התצוגה"
                className="h-8 rounded-md border border-indigo-300 bg-white px-2 text-[12px] text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                ⟳ עדכון התצוגה
              </button>
            )}
            {selectedView?.editable && (
              <button
                type="button"
                disabled={viewBusy}
                onClick={() => setConfirmDeleteView(true)}
                title="מחיקת התצוגה השמורה"
                className="h-8 rounded-md px-1.5 text-[12px] text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                🗑
              </button>
            )}
            {!saveOpen ? (
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                className="h-8 rounded-md border border-gray-300 bg-white px-2 text-[12px] text-gray-600 hover:bg-gray-50"
              >
                💾 שמירת תצוגה…
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50/60 px-2 py-1">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveNewView();
                    if (e.key === 'Escape') { setSaveOpen(false); setSaveName(''); }
                  }}
                  placeholder="שם התצוגה"
                  maxLength={60}
                  className="h-6 w-32 rounded border border-indigo-300 bg-white px-1.5 text-[12px]"
                />
                <label className="flex items-center gap-1 text-[11px] text-gray-600">
                  <input type="radio" checked={saveScope === 'personal'} onChange={() => setSaveScope('personal')} /> אישית
                </label>
                <label className="flex items-center gap-1 text-[11px] text-gray-600">
                  <input type="radio" checked={saveScope === 'shared'} onChange={() => setSaveScope('shared')} /> משותפת
                </label>
                <button
                  type="button"
                  disabled={!saveName.trim() || viewBusy}
                  onClick={saveNewView}
                  className="h-6 rounded bg-indigo-600 px-2 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  שמירה
                </button>
                <button type="button" onClick={() => { setSaveOpen(false); setSaveName(''); }} className="text-[11px] text-gray-500 hover:underline">
                  ביטול
                </button>
              </span>
            )}
          </>
        )}

        <div className="ms-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-400">
            {loading ? '…' : `${data.total} משימות`}
            {data.truncated && ' (מוצג חלק)'}
          </span>
          <ColumnPicker
            columns={cols.orderedColumns}
            colKeys={cols.colKeys}
            onToggle={cols.toggleCol}
            onMove={cols.moveCol}
            onReset={cols.resetCols}
          />
        </div>
      </div>

      {error && <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700">{error}</div>}

      {/* ── the grid ──
          The OUTER div is the positioning context and does NOT scroll; the
          inner div scrolls. The drawer is `absolute inset-0` against the outer
          one, so it covers exactly the table area and stays put while the table
          behind it keeps its scroll position. (Putting it inside the scroller
          would make it scroll away with the rows.) */}
      <div className="relative min-h-0 flex-1">
      <div ref={gridRef} className="h-full overflow-auto">
        {/* Mobile: cards over the SAME rows/handlers — presentation only. */}
        <div className="bg-white md:hidden">
          <TaskCards
            rows={rows}
            today={today}
            cursor={cursor}
            selected={selected}
            freshIds={freshIds}
            savingId={savingId}
            onOpen={openDrawer}
            onToggleSelect={(id, idx) => toggleRow(id, idx, false)}
            onComplete={completeRow}
          />
          {!rows.length && !loading && (
            <div className="px-4 py-12 text-center text-sm text-gray-400">
              {data.empty ? 'אין ימים בטווח הזה' : 'אין משימות שתואמות את הסינון'}
            </div>
          )}
        </div>
        <table className="hidden w-full border-collapse bg-white text-[13px] md:table">
          <thead className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur">
            <SortableHeaderRow
              cols={cols.visibleCols}
              onMove={cols.moveCol}
              sort={sort}
              onSort={onSort}
              widths={cols.widths}
              onResize={cols.setColWidth}
              trClassName="border-b border-gray-200 text-gray-500"
              leading={
                <th className={`w-9 px-2 ${COL_SEP}`}>
                  <input
                    type="checkbox"
                    aria-label="בחר הכול"
                    checked={allVisibleSelected}
                    onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    className="accent-blue-600"
                  />
                </th>
              }
            >
              <th className="w-16 px-2" />
            </SortableHeaderRow>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                data-rowidx={idx}
                // Clicking anywhere that is not a control opens the Deal drawer
                // — the table stays visible, the operator keeps their place.
                onClick={() => openDrawer(idx)}
                className={`border-b border-gray-100 transition-colors duration-700 ${
                  freshIds.has(row.id) ? 'bg-indigo-100/70' : rowTone(row, today)
                } ${idx === cursor ? 'ring-1 ring-inset ring-blue-400' : ''} ${
                  selected.has(row.id) ? 'bg-blue-50/60' : 'hover:bg-gray-50'
                }`}
              >
                <td className={`px-2 ${COL_SEP}`} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="בחירת שורה"
                    checked={selected.has(row.id)}
                    onChange={(e) => toggleRow(row.id, idx, e.nativeEvent.shiftKey)}
                    className="accent-blue-600"
                  />
                </td>
                {cols.visibleCols.map((col) => (
                  <TableCell
                    key={col.key}
                    col={col}
                    className={`py-1.5 ${canEditCell(col, row) ? 'cursor-text hover:bg-blue-50/40' : ''}`}
                  >
                    <span
                      // An editable cell is a CONTROL: CLICK opens the inline
                      // editor in place (binding UX decision — no drawer, no
                      // modal). Everywhere non-editable opens the Deal drawer.
                      onClick={
                        canEditCell(col, row)
                          ? (e) => { e.stopPropagation(); setCursor(idx); setEditing({ rowId: row.id, colKey: col.key }); }
                          : undefined
                      }
                      // A locked cell explains itself instead of failing silently.
                      title={
                        col.key === 'taskType' && row.channel === 'whatsapp'
                          ? 'סוג של משימת וואטסאפ נעול — קשור להודעה מתוזמנת'
                          : col.key === 'status' && row.status !== 'open'
                            ? 'סטטוס סופי — תיקוני שדות מותרים, פתיחה מחדש לא'
                            : undefined
                      }
                      className="block"
                    >
                      {cellContent(col, row)}
                    </span>
                  </TableCell>
                ))}
                <td className="px-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {row.status === 'open' && (
                      <button
                        type="button"
                        title="סמן כהושלמה (Ctrl+Enter)"
                        disabled={savingId === row.id}
                        onClick={() => completeRow(row)}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                      >
                        ✓
                      </button>
                    )}
                    <button
                      type="button"
                      title="פתיחת הדיל בעמוד מלא"
                      onClick={() => navigate(dealPath(row.deal))}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    >
                      ↗
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={cols.visibleCols.length + 2} className="px-4 py-12 text-center text-sm text-gray-400">
                  {data.empty ? 'אין ימים בטווח הזה' : 'אין משימות שתואמות את הסינון'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── the Deal drawer ──
          Prev/Next walk the current filtered ROW order. The position counts
          rows, not deals: two tasks can share one deal, and deduping would make
          the indicator lie about where you are in the queue. */}
      {drawerIdx != null && drawerDealId && (
        <DealDrawer
          dealId={drawerDealId}
          onClose={() => setDrawerIdx(null)}
          onPrev={drawerIdx > 0 ? () => stepDrawer(-1) : undefined}
          onNext={drawerIdx < rows.length - 1 ? () => stepDrawer(1) : undefined}
          position={`${drawerIdx + 1} מתוך ${rows.length}`}
        />
      )}
      </div>

      {/* ── bulk action bar: inline, never a modal (the one exception is the
          cancel CONFIRM, which is an in-system dialog, not a native one) ── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-blue-200 bg-blue-50 px-3 py-2 text-[12px]">
          <span className="font-semibold text-blue-800">{selected.size} נבחרו</span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => runBulk('complete')}
            className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            ✓ השלמה
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => setConfirmCancel(true)}
            className="rounded-md border border-red-300 bg-white px-2.5 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            ביטול משימות…
          </button>
          <span className="mx-1 h-5 w-px bg-blue-200" />
          <select
            disabled={bulkBusy}
            value=""
            onChange={(e) => e.target.value && runBulk('assign_owner', { ownerUserId: e.target.value })}
            className="h-7 rounded-md border border-blue-300 bg-white px-1.5 text-[12px]"
          >
            <option value="">שינוי אחראי…</option>
            {boot.users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
          </select>
          <select
            disabled={bulkBusy}
            value=""
            onChange={(e) => e.target.value && runBulk('set_priority', { priority: e.target.value })}
            className="h-7 rounded-md border border-blue-300 bg-white px-1.5 text-[12px]"
          >
            <option value="">שינוי עדיפות…</option>
            <option value="high">גבוהה</option>
            <option value="medium">בינונית</option>
            <option value="low">נמוכה</option>
            <option value="none">ללא</option>
          </select>
          <select
            disabled={bulkBusy}
            value=""
            onChange={(e) => e.target.value && runBulk('set_type', { taskTypeId: e.target.value })}
            className="h-7 rounded-md border border-blue-300 bg-white px-1.5 text-[12px]"
          >
            <option value="">שינוי סוג…</option>
            {boot.types.filter((t) => t.channel !== 'whatsapp').map((t) => (
              <option key={t.id} value={t.id}>{t.nameHe}</option>
            ))}
          </select>
          <div className="w-36">
            <DateField
              placeholder="שינוי תאריך…"
              value={null}
              clearable={false}
              disabled={bulkBusy}
              onChange={(v) => v && runBulk('set_due_date', { dueDate: v })}
            />
          </div>
          <div className="w-28">
            <TimeField
              placeholder="שינוי שעה…"
              value=""
              disabled={bulkBusy}
              onChange={(v) => runBulk('set_due_time', { dueTime: v || null })}
            />
          </div>
          {bulkBusy && <span className="text-blue-500">מעדכן…</span>}
          <button type="button" onClick={() => { setSelected(new Set()); setBulkReport(null); }} className="ms-auto text-blue-700 hover:underline">
            ניקוי בחירה
          </button>
        </div>
      )}

      {/* Per-row partial-failure report — the failed rows stay selected for retry. */}
      {bulkReport && (
        <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <span className="font-semibold">
            הצליחו {bulkReport.succeeded} · נכשלו {bulkReport.failed.length}:
          </span>
          <span className="min-w-0 flex-1">
            {Object.entries(
              bulkReport.failed.reduce((m, f) => ({ ...m, [f.error]: (m[f.error] || 0) + 1 }), {}),
            )
              .map(([code, n]) => `${writeError(code)} (${n})`)
              .join(' · ')}
            <span className="text-amber-600"> — השורות שנכשלו נשארו מסומנות</span>
          </span>
          <button type="button" onClick={() => setBulkReport(null)} className="text-amber-700 hover:underline">
            סגירה
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteView}
        danger
        title="מחיקת תצוגה שמורה"
        body={`למחוק את התצוגה "${selectedView?.name ?? ''}"?${selectedView?.scope === 'shared' ? ' התצוגה משותפת — היא תיעלם גם אצל שאר המשתמשים.' : ''}`}
        confirmLabel="מחיקה"
        cancelLabel="חזרה"
        onCancel={() => setConfirmDeleteView(false)}
        onConfirm={() => { setConfirmDeleteView(false); deleteSelectedView(); }}
      />

      <ConfirmDialog
        open={confirmCancel}
        danger
        title="ביטול משימות"
        body={`לבטל ${selected.size} משימות? הביטול נרשם בהיסטוריית הדיל (אין מחיקה במערכת). משימות וואטסאפ מתוזמנות — ההודעה לא תישלח.`}
        confirmLabel="ביטול המשימות"
        cancelLabel="חזרה"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { setConfirmCancel(false); runBulk('cancel'); }}
      />

      {/* ── pagination ── */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-500">
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded px-2 py-1 disabled:opacity-30 hover:bg-gray-100">
            ‹ הקודם
          </button>
          <span>עמוד {page} מתוך {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded px-2 py-1 disabled:opacity-30 hover:bg-gray-100">
            הבא ›
          </button>
        </div>
        <span className="hidden text-[11px] text-gray-400 md:inline">
          ↑↓ ניווט · Enter פתיחה · רווח בחירה · Ctrl+Enter השלמה · לחיצה כפולה לעריכה
        </span>
      </div>
    </div>
  );
}

// Inline cell editor — editing happens IN the cell. Dates/times use the shared
// DateTimeFields (never native inputs, per the project's picker rule). Save is
// an explicit selection/pick (Enter within the pickers); Esc cancels.
function InlineEditor({ col, row, boot, onCancel, onSave, onTransition }) {
  const stop = (e) => e.stopPropagation();
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
  };

  if (col.key === 'status') {
    // Transitions, not field edits: completing/cancelling from the cell rides
    // the SAME canonical path as the ✓ button and bulk actions. A WhatsApp
    // task completed here follows its rule — the send is pulled, never fired.
    return (
      <select
        autoFocus
        onClick={stop}
        onKeyDown={onKeyDown}
        defaultValue="open"
        onBlur={onCancel}
        onChange={(e) => {
          if (e.target.value === 'completed') onTransition('complete');
          else if (e.target.value === 'cancelled') onTransition('cancel');
          else onCancel();
        }}
        className="h-7 w-full rounded border border-blue-400 bg-white px-1 text-[12px]"
      >
        <option value="open">פתוחה</option>
        <option value="completed">הושלמה ✓</option>
        <option value="cancelled">בוטלה</option>
      </select>
    );
  }

  if (col.key === 'dueDate') {
    return <div onClick={stop} onKeyDown={onKeyDown} className="w-36"><DateField value={dueDateOf(row)} onChange={(v) => v && onSave({ dueDate: v })} clearable={false} /></div>;
  }
  if (col.key === 'dueTime') {
    return <div onClick={stop} onKeyDown={onKeyDown} className="w-28"><TimeField value={row.dueTime || ''} onChange={(v) => onSave({ dueTime: v || null })} /></div>;
  }
  if (col.key === 'priority') {
    return (
      <select autoFocus onClick={stop} onKeyDown={onKeyDown} defaultValue={row.priority || 'none'} onBlur={onCancel}
        onChange={(e) => onSave({ priority: e.target.value === 'none' ? null : e.target.value })}
        className="h-7 w-full rounded border border-blue-400 bg-white px-1 text-[12px]">
        <option value="high">{priorityLabel('high')}</option>
        <option value="medium">{priorityLabel('medium')}</option>
        <option value="low">{priorityLabel('low')}</option>
        <option value="none">ללא</option>
      </select>
    );
  }
  if (col.key === 'owner') {
    return (
      <select autoFocus onClick={stop} onKeyDown={onKeyDown} defaultValue={row.owner?.id || ''} onBlur={onCancel}
        onChange={(e) => e.target.value && onSave({ ownerUserId: e.target.value })}
        className="h-7 w-full rounded border border-blue-400 bg-white px-1 text-[12px]">
        {boot.users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
      </select>
    );
  }
  if (col.key === 'taskType') {
    // WhatsApp-channel target types are not offered — a task cannot be retyped
    // INTO WhatsApp (the server refuses it; WhatsApp tasks are born in the
    // composer). WhatsApp SOURCE rows never reach this editor (canEditCell).
    return (
      <select autoFocus onClick={stop} onKeyDown={onKeyDown} defaultValue={row.taskType?.id || ''} onBlur={onCancel}
        onChange={(e) => e.target.value && onSave({ taskTypeId: e.target.value })}
        className="h-7 w-full rounded border border-blue-400 bg-white px-1 text-[12px]">
        {boot.types.filter((t) => t.channel !== 'whatsapp').map((t) => (
          <option key={t.id} value={t.id}>{t.nameHe}</option>
        ))}
      </select>
    );
  }
  return col.render(row);
}
