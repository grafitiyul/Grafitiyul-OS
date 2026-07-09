import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AnchoredMenu from './AnchoredMenu.jsx';
import {
  normalizeColumnState,
  toggleVisibleKey,
  moveKey,
  orderedVisibleColumns,
} from './tableColumnsCore.js';

// Reusable table-column infrastructure, shared by the CRM list screens
// (Deals, Contacts, Organizations, Collection). A `column` is
// { key, label, def?, disabled?, … } — list screens keep their own render
// functions; this owns WHICH columns show, in WHAT order, the picker UI, and
// the drag-reorderable header row. Both visibility and order persist per
// `storageKey` in localStorage (per table; per browser profile — the app's
// standard persistence layer, same as filters and workspace layout).
// Pure state logic lives in tableColumnsCore.js (unit-tested).

function loadState(storageKey, canonicalKeys, defaults) {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    /* fall through to defaults */
  }
  return normalizeColumnState(raw, canonicalKeys, defaults);
}
function saveState(storageKey, state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function useTableColumns(storageKey, columns) {
  const canonicalKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const defaults = useMemo(() => columns.filter((c) => c.def).map((c) => c.key), [columns]);
  const [state, setState] = useState(() => loadState(storageKey, canonicalKeys, defaults));
  useEffect(() => {
    saveState(storageKey, state);
  }, [storageKey, state]);

  // Visible columns in the USER's order — what the table renders.
  const visibleCols = useMemo(() => orderedVisibleColumns(columns, state), [columns, state]);
  // All columns in the user's order — what the picker lists.
  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return state.order.map((k) => byKey.get(k)).filter(Boolean);
  }, [columns, state.order]);

  function toggleCol(key) {
    setState((s) => ({ ...s, visible: toggleVisibleKey(s.visible, key) }));
  }
  function moveCol(fromKey, toKey) {
    setState((s) => ({ ...s, order: moveKey(s.order, fromKey, toKey) }));
  }
  return { colKeys: state.visible, toggleCol, moveCol, visibleCols, orderedColumns };
}

// "עמודות" picker — toggles which columns the table shows. Portal-anchored menu
// so a long list is never clipped.
export function ColumnPicker({ columns, colKeys, onToggle, label = 'עמודות' }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden>⚙️</span>
        {label}
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={236} align="end">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400">בחירת עמודות</div>
        <div className="max-h-[60vh] overflow-y-auto py-0.5">
          {columns.map((c) => {
            const checked = colKeys.includes(c.key);
            return (
              <label
                key={c.key}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                  c.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={c.disabled}
                  onChange={() => onToggle(c.key)}
                  className="accent-blue-600"
                />
                <span className="text-gray-700">{c.label}</span>
                {c.disabled && <span className="text-[10px] text-gray-400">(בקרוב)</span>}
              </label>
            );
          })}
        </div>
      </AnchoredMenu>
    </div>
  );
}

// ── Drag-reorderable header row ──────────────────────────────────────────
// Drop-in <thead> row: each column header is draggable; dropping it reorders
// the table (onMove persists through useTableColumns). rectSortingStrategy
// works off real DOM rects, so it behaves correctly in RTL. A small pointer
// distance keeps plain clicks (e.g. future sort-by-column) from starting a
// drag. `children` renders AFTER the sortable cells — for trailing utility
// columns like the row-actions spacer.

const TH_BASE = 'text-[11px] uppercase tracking-wide font-semibold px-4 py-2.5';

// RTL table alignment convention: everything sits on the RIGHT by default —
// headers and values alike — so the table reads naturally right-to-left.
// `col.align` ('left' | 'center') is an explicit, per-column override for the
// few cases with a clear reason (progress bars, icon/action cells, …).
// `col.dir` ('ltr') only fixes glyph order for numbers/dates/emails — an LTR
// value still sits on the right edge like every other cell.
function alignClass(col) {
  return col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right';
}

// Keep the drag strictly horizontal — headers only ever move along the row.
const horizontalOnly = ({ transform }) => ({ ...transform, y: 0 });

function SortableTh({ col, className, sort, onSort }) {
  const s = useSortable({ id: col.key });
  // Click = sort (when the screen opts in via onSort and the column allows
  // it); drag past the 8px activation distance = reorder. dnd-kit only
  // swallows the click once a real drag started, so both coexist.
  const sortable = !!onSort && col.sortable !== false;
  const active = sortable && sort?.key === col.key;
  return (
    <th
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      {...s.attributes}
      {...s.listeners}
      onClick={sortable ? () => onSort(col.key) : undefined}
      title={sortable ? 'לחיצה למיון · גרירה לשינוי סדר' : 'גרירה לשינוי סדר העמודות'}
      className={`${TH_BASE} ${alignClass(col)} cursor-grab select-none active:cursor-grabbing ${
        s.isDragging ? 'z-10 rounded-md bg-blue-50 text-blue-700 shadow-sm' : ''
      } ${active ? 'text-blue-700' : ''} ${className || ''}`}
    >
      {col.label}
      {active && <span className="ms-1 text-[9px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

// Shared body cell — enforces the same RTL alignment convention as the
// headers (right by default, col.align overrides), applies the column's
// `cls`/`dir`, so every CRM table inherits one consistent look. `stopClick`
// is for action cells inside clickable rows (kebab, open-buttons).
export function TableCell({ col = {}, className = '', stopClick = false, children }) {
  return (
    <td
      className={`px-4 py-3 align-middle ${alignClass(col)} ${col.cls || ''} ${className}`}
      dir={col.dir}
      onClick={stopClick ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </td>
  );
}

export function SortableHeaderRow({ cols, onMove, trClassName = '', thClassName, sort, onSort, children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  function onDragEnd({ active, over }) {
    if (over && active.id !== over.id) onMove(active.id, over.id);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[horizontalOnly]}
    >
      <SortableContext items={cols.map((c) => c.key)} strategy={rectSortingStrategy}>
        <tr className={trClassName}>
          {cols.map((c) => (
            <SortableTh
              key={c.key}
              col={c}
              className={thClassName ? thClassName(c) : ''}
              sort={sort}
              onSort={onSort}
            />
          ))}
          {children}
        </tr>
      </SortableContext>
    </DndContext>
  );
}
