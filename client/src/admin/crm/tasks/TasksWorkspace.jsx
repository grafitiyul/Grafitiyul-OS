import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { dealPath } from '../../deals/config.js';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell, COL_SEP } from '../../common/tableColumns.jsx';
import { toggleSortKey, sortFromParam } from '../../common/tableColumnsCore.js';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';
import { useTourMidnightRefresh } from '../../tours/tourEvents.js';
import { TASK_COLUMNS, COLUMNS_KEY, SORTABLE_KEYS, rowTone, priorityLabel, dueDateOf } from './columns.jsx';
import {
  TIME_CHIPS, defaultFilters, filtersFromParams, filtersToParams, filtersToQuery,
  selectWindow, statusLockedBy, toggleIn, hasActiveFilters, rangeIncomplete,
  loadFilters, saveFilters, sortToParam,
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

const CHIP_TONE = {
  primary: 'bg-emerald-600 text-white ring-emerald-600',
  danger: 'bg-red-600 text-white ring-red-600',
  warn: 'bg-amber-500 text-white ring-amber-500',
  plain: 'bg-slate-700 text-white ring-slate-700',
};

function Chip({ active, disabled, onClick, children, tone = 'plain', title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ring-1 transition ${
        disabled
          ? 'cursor-not-allowed bg-gray-50 text-gray-300 ring-gray-200'
          : active
            ? `${CHIP_TONE[tone]} shadow-sm`
            : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

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

  const cols = useTableColumns(COLUMNS_KEY, TASK_COLUMNS);
  const gridRef = useRef(null);
  const lastClickedRow = useRef(null);

  // ── bootstrap: who am I, plus the filter vocabularies ──
  useEffect(() => {
    let alive = true;
    (async () => {
      // taskTypes drive the type chips and are REAL if they fail. The rest are
      // best-effort: a missing owner list degrades a filter, not the screen.
      const [ttRes, usRes, status, stRes] = await Promise.all([
        api.taskTypes.list(true).catch(() => []),
        api.adminUsers.list().catch(() => ({ users: [] })),
        api.auth.status().catch(() => ({})),
        api.dealStages.list().catch(() => []),
      ]);
      if (!alive) return;
      const types = Array.isArray(ttRes) ? ttRes : ttRes?.taskTypes || [];
      const users = (Array.isArray(usRes) ? usRes : usRes?.users || []).filter((u) => u.isActive);
      const stages = Array.isArray(stRes) ? stRes : stRes?.dealStages || stRes?.stages || [];
      const me = users.find((u) => u.username === status?.username)?.id || null;
      setBoot({ me, types, users, stages });
      // The URL wins over the remembered workspace, so a shared link opens what
      // the sender saw rather than the recipient's last view.
      setFilters([...searchParams.keys()].length ? filtersFromParams(searchParams, me) : loadFilters(me));
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

  const load = useCallback(async () => {
    if (!filters || rangeIncomplete(filters)) return;
    setLoading(true);
    setError('');
    try {
      // The counts bar deliberately ignores `window` — it varies only that.
      const countsQuery = filtersToQuery({ ...filters, window: 'today' }, [], 1, null);
      const [list, cnt] = await Promise.all([
        api.tasks.list(query),
        api.tasks.counts(countsQuery).catch(() => null),
      ]);
      setData(list);
      if (cnt) setCounts(cnt);
      setCursor(0);
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, query]);

  useEffect(() => { load(); }, [load]);

  // The window bounds move at Israel midnight — reuse the ONE existing timer
  // rather than writing a second one.
  useTourMidnightRefresh(() => load());

  const rows = data.rows || [];
  const today = data.today;
  const pages = Math.max(Math.ceil((data.total || 0) / PAGE_SIZE), 1);
  const statusLock = filters ? statusLockedBy(filters) : null;

  const patch = (next) => { setFilters(next); setPage(1); setSelected(new Set()); };

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

  // ── writes: reuse the EXISTING deal-scoped task endpoints ──
  async function completeRow(row) {
    if (row.status !== 'open') return;
    setSavingId(row.id);
    try {
      await api.dealTasks.complete(row.deal.id, row.id);
      await load();
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setSavingId(null);
    }
  }

  async function saveCell(row, data2) {
    setSavingId(row.id);
    try {
      await api.dealTasks.update(row.deal.id, row.id, data2);
      setEditing(null);
      await load();
    } catch (e) {
      // 409 task_not_open is the real contract: a terminal task is read-only.
      setError(e.payload?.error === 'task_not_open' ? 'לא ניתן לערוך משימה שאינה פתוחה' : e.payload?.error || e.message);
      setEditing(null);
    } finally {
      setSavingId(null);
    }
  }

  // ── keyboard ──
  useEffect(() => {
    function onKey(e) {
      if (editing) return; // the cell editor owns the keyboard while open
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const row = rows[cursor];
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      else if (e.key === ' ' && row) { e.preventDefault(); toggleRow(row.id, cursor, e.shiftKey); }
      else if (e.key === 'Enter' && row) { e.preventDefault(); navigate(dealPath(row.deal)); }
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

  const editable = (row) => row.status === 'open';

  function cellContent(col, row) {
    const isEditing = editing?.rowId === row.id && editing?.colKey === col.key;
    if (isEditing) return <InlineEditor col={col} row={row} boot={boot} onCancel={() => setEditing(null)} onSave={(d) => saveCell(row, d)} />;
    return col.render(row);
  }

  // Inline-editable columns. TASK TYPE is deliberately absent: the existing
  // PATCH accepts text/priority/ownerUserId/notes/dueDate/dueTime and NOT
  // taskTypeId, so a type editor here would silently do nothing. Changing a
  // type also re-snapshots `channel`, which for a WhatsApp task would orphan a
  // real scheduled send — that guard belongs with the write-path unification in
  // Slice 4, and the editor arrives with it.
  const INLINE_KEYS = new Set(['priority', 'owner', 'dueDate', 'dueTime']);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50" dir="rtl">
      {/* ── time chips: the primary navigation ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2">
        {TIME_CHIPS.map((chip) => {
          const isEmpty = Boolean(counts.empty?.[chip.key]);
          const n = chip.key === 'range' ? null : counts.counts?.[chip.key];
          return (
            <Chip
              key={chip.key}
              tone={chip.tone}
              active={filters.window === chip.key}
              // "השבוע" has no days at all on Fri/Sat — disabled at 0, never
              // redefined to overlap another chip.
              disabled={isEmpty}
              title={isEmpty ? 'אין ימים בטווח הזה השבוע' : undefined}
              onClick={() => patch(selectWindow(filters, chip.key))}
            >
              <span aria-hidden>{chip.emoji}</span>
              {chip.label}
              <Count n={isEmpty ? 0 : n} active={filters.window === chip.key} />
            </Chip>
          );
        })}
        {filters.window === 'range' && (
          <div className="flex items-center gap-2 ps-2">
            <div className="w-36"><DateField value={filters.rangeFrom} onChange={(v) => patch({ ...filters, rangeFrom: v })} placeholder="מתאריך" /></div>
            <div className="w-36"><DateField value={filters.rangeTo} onChange={(v) => patch({ ...filters, rangeTo: v })} placeholder="עד תאריך" /></div>
          </div>
        )}
      </div>

      {/* ── task-type chips + filters ── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2">
        {boot.types.map((t) => (
          <Chip
            key={t.id}
            active={filters.typeKeys.includes(t.key)}
            onClick={() => patch({ ...filters, typeKeys: toggleIn(filters.typeKeys, t.key) })}
          >
            {t.nameHe}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <select
          value={filters.ownerIds[0] || ''}
          onChange={(e) => patch({ ...filters, ownerIds: e.target.value ? [e.target.value] : [] })}
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-[12px] text-gray-700"
        >
          <option value="">כל האחראים</option>
          {boot.users.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName || u.username}{u.id === boot.me ? ' (אני)' : ''}</option>
          ))}
        </select>
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
        <select
          value={filters.stageIds[0] || ''}
          onChange={(e) => patch({ ...filters, stageIds: e.target.value ? [e.target.value] : [] })}
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-[12px] text-gray-700"
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
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-[12px] text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="open">פתוחות</option>
          <option value="completed">הושלמו</option>
          <option value="all">הכול</option>
        </select>
        {hasActiveFilters(filters) && (
          <button type="button" onClick={() => patch(defaultFilters(boot.me))} className="h-8 rounded-md px-2 text-[12px] text-blue-700 hover:bg-blue-50">
            נקה סינון
          </button>
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

      {/* ── the grid ── */}
      <div ref={gridRef} className="relative min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse bg-white text-[13px]">
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
                onClick={() => setCursor(idx)}
                className={`border-b border-gray-100 transition-colors ${rowTone(row, today)} ${
                  idx === cursor ? 'ring-1 ring-inset ring-blue-400' : ''
                } ${selected.has(row.id) ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
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
                    className={`py-1.5 ${INLINE_KEYS.has(col.key) && editable(row) ? 'cursor-text hover:bg-blue-50/40' : ''}`}
                  >
                    <span
                      onDoubleClick={INLINE_KEYS.has(col.key) && editable(row) ? () => setEditing({ rowId: row.id, colKey: col.key }) : undefined}
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
                      title="פתיחת הדיל"
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

      {/* ── selection bar: inline, never a modal ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 border-t border-blue-200 bg-blue-50 px-3 py-2 text-[12px]">
          <span className="font-semibold text-blue-800">{selected.size} נבחרו</span>
          <span className="text-blue-500">פעולות מרובות — בקרוב</span>
          <button type="button" onClick={() => setSelected(new Set())} className="ms-auto text-blue-700 hover:underline">
            ניקוי בחירה
          </button>
        </div>
      )}

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
        <span className="text-[11px] text-gray-400">
          ↑↓ ניווט · Enter פתיחה · רווח בחירה · Ctrl+Enter השלמה · לחיצה כפולה לעריכה
        </span>
      </div>
    </div>
  );
}

// Inline cell editor — editing happens IN the cell. Dates/times use the shared
// DateTimeFields (never native inputs, per the project's picker rule).
function InlineEditor({ col, row, boot, onCancel, onSave }) {
  const stop = (e) => e.stopPropagation();
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
  };

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
  return col.render(row);
}
