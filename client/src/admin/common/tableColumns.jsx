import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AnchoredMenu from './AnchoredMenu.jsx';
import {
  normalizeColumnState,
  toggleVisibleKey,
  moveKey,
  orderedVisibleColumns,
  setKeyWidth,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
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
  // Committed once per resize drag (on release), then persisted like the rest.
  function setColWidth(key, px, min, max) {
    setState((s) => ({ ...s, widths: setKeyWidth(s.widths, key, px, min, max) }));
  }
  // "איפוס לברירת מחדל" — back to the canonical order + default visibility
  // (and fluid widths), exactly as a first visit.
  function resetCols() {
    setState(normalizeColumnState(null, canonicalKeys, defaults));
  }
  return {
    colKeys: state.visible,
    toggleCol,
    moveCol,
    setColWidth,
    resetCols,
    widths: state.widths,
    visibleCols,
    orderedColumns,
  };
}

// "עמודות" picker — toggles which columns the table shows. Portal-anchored menu
// so a long list is never clipped. Optional extras (opt-in, so existing
// screens are unchanged until they pass the props):
//   onMove(fromKey, toKey) — rows become drag-reorderable (handle + dnd-kit
//     vertical list; pass `columns` in the USER's order, e.g. orderedColumns)
//   onReset()             — renders "איפוס לברירת מחדל" at the bottom
export function ColumnPicker({ columns, colKeys, onToggle, onMove, onReset, label = 'עמודות' }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rows = columns.map((c) => (
    <PickerRow key={c.key} col={c} checked={colKeys.includes(c.key)} onToggle={onToggle} draggable={!!onMove} />
  ));
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
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={252} align="end">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400">
          {onMove ? 'בחירת עמודות וסדר' : 'בחירת עמודות'}
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-0.5">
          {onMove ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (over && active.id !== over.id) onMove(active.id, over.id);
              }}
            >
              <SortableContext items={columns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                {rows}
              </SortableContext>
            </DndContext>
          ) : (
            rows
          )}
        </div>
        {onReset && (
          <div className="border-t border-gray-100 p-1">
            <button
              type="button"
              onClick={onReset}
              className="w-full rounded-md px-3 py-1.5 text-right text-[12.5px] text-gray-500 hover:bg-gray-50 hover:text-gray-800"
            >
              ↺ איפוס לברירת מחדל
            </button>
          </div>
        )}
      </AnchoredMenu>
    </div>
  );
}

function PickerRow({ col, checked, onToggle, draggable }) {
  const s = useSortable({ id: col.key, disabled: !draggable });
  return (
    <div
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={`flex items-center gap-2 px-2 py-1.5 text-sm ${
        s.isDragging ? 'z-10 rounded-md bg-blue-50 shadow-sm' : ''
      } ${col.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-gray-50'}`}
    >
      {draggable && (
        <button
          type="button"
          {...s.attributes}
          {...s.listeners}
          aria-label={`גרירה לשינוי מיקום ${col.label}`}
          className="cursor-grab touch-none px-0.5 text-gray-300 hover:text-gray-500 active:cursor-grabbing"
        >
          ⠿
        </button>
      )}
      <label className={`flex flex-1 items-center gap-2 ${col.disabled ? '' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={col.disabled}
          onChange={() => onToggle(col.key)}
          className="accent-blue-600"
        />
        <span className="text-gray-700">{col.label}</span>
        {col.disabled && <span className="text-[10px] text-gray-400">(בקרוב)</span>}
      </label>
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

// Column separator — a whisper of a line on each cell's inline-start edge
// (logical property → RTL-correct), skipped on the first cell. Lighter than
// the gray-100 row dividers so the grid reads as a premium list, not a
// spreadsheet.
export const COL_SEP = 'border-s border-gray-100/70 first:border-s-0';

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

// The `sort` prop accepts EITHER a single {key,dir} (the original contract, still
// used by Deals/Contacts/Collection/Tours) or an ORDERED array of them for
// multi-column sort. Normalising here keeps every existing caller working
// untouched while the Tasks workspace passes an array.
function sortList(sort) {
  if (!sort) return [];
  return Array.isArray(sort) ? sort : [sort];
}

function SortableTh({ col, className, sort, onSort, width, resizable, onResizeEnd }) {
  const s = useSortable({ id: col.key });
  const thRef = useRef(null);
  const setRefs = (el) => {
    s.setNodeRef(el);
    thRef.current = el;
  };
  // Click = sort (when the screen opts in via onSort and the column allows
  // it); drag past the 8px activation distance = reorder. dnd-kit only
  // swallows the click once a real drag started, so both coexist.
  const sortable = !!onSort && col.sortable !== false;
  const list = sortList(sort);
  const idx = list.findIndex((s2) => s2.key === col.key);
  const active = sortable && idx >= 0;
  const entry = active ? list[idx] : null;
  // With more than one active sort, show each column's RANK — otherwise the
  // arrows alone can't say which column sorted first.
  const rank = active && list.length > 1 ? idx + 1 : null;

  // Resize: drag the header's inline-end edge, and THAT edge follows the
  // pointer while every other edge stays anchored. A w-full auto-layout table
  // can't do that (growing one column makes the browser steal the difference
  // from its neighbors — the opposite edge moves), so for the drag we freeze
  // the current geometry: every header gets its measured pixel width, the
  // table switches to fixed layout with an explicit total, and each pointer
  // move changes ONLY this column's width + the table total. In RTL the table
  // grows leftward inside its overflow-x wrapper (right edge pinned), so the
  // grabbed left edge tracks the pointer 1:1. Committed once on release.
  function startResize(e) {
    const th = thRef.current;
    const table = th?.closest('table');
    if (!th || !table) return;
    e.preventDefault();
    e.stopPropagation(); // never start a dnd column drag from the handle
    // Freeze: snapshot every header cell, then pin the table itself.
    for (const cell of th.parentElement.children) {
      cell.style.width = `${cell.offsetWidth}px`;
    }
    const startX = e.clientX;
    const startW = th.offsetWidth;
    const startTableW = table.offsetWidth;
    table.style.tableLayout = 'fixed';
    table.style.width = `${startTableW}px`;
    const rtl = getComputedStyle(th).direction === 'rtl';
    const min = col.minWidth || MIN_COL_WIDTH;
    const max = col.maxWidth || MAX_COL_WIDTH;
    function onMove(ev) {
      const delta = rtl ? startX - ev.clientX : ev.clientX - startX;
      const w = Math.min(max, Math.max(min, Math.round(startW + delta)));
      th.style.width = `${w}px`;
      table.style.width = `${startTableW + (w - startW)}px`;
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      onResizeEnd();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  return (
    <th
      ref={setRefs}
      data-colkey={col.key}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
        width: width ? `${width}px` : undefined,
      }}
      {...s.attributes}
      {...s.listeners}
      onClick={sortable ? (e) => onSort(col.key, { additive: e.shiftKey }) : undefined}
      title={
        sortable
          ? 'לחיצה למיון · Shift+לחיצה להוספת מיון · גרירה לשינוי סדר'
          : 'גרירה לשינוי סדר העמודות'
      }
      className={`${TH_BASE} ${COL_SEP} ${alignClass(col)} relative cursor-grab select-none active:cursor-grabbing ${
        s.isDragging ? 'z-10 rounded-md bg-blue-50 text-blue-700 shadow-sm' : ''
      } ${active ? 'text-blue-700' : ''} ${className || ''}`}
    >
      {col.label}
      {active && <span className="ms-1 text-[9px]">{entry.dir === 'asc' ? '▲' : '▼'}</span>}
      {rank && <span className="ms-0.5 align-super text-[8px] font-bold text-blue-600">{rank}</span>}
      {resizable && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`שינוי רוחב ${col.label}`}
          onPointerDown={startResize}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 end-0 w-1.5 cursor-col-resize touch-none rounded hover:bg-blue-300/60"
        />
      )}
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
      className={`px-4 py-3 align-middle ${COL_SEP} ${alignClass(col)} ${col.cls || ''} ${className}`}
      dir={col.dir}
      onClick={stopClick ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </td>
  );
}

export function SortableHeaderRow({
  cols,
  onMove,
  trClassName = '',
  thClassName,
  sort,
  onSort,
  widths,
  onResize,
  leading = null, // optional utility cell(s) BEFORE the sortable columns (e.g. row-selection checkbox)
  children,
}) {
  const rowRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  function onDragEnd({ active, over }) {
    if (over && active.id !== over.id) onMove(active.id, over.id);
  }

  // Resize release: persist the measured width of EVERY column (the drag
  // froze all of them), so the anchored geometry survives re-renders and
  // reloads instead of snapping back to fluid distribution. React batches
  // the per-column setState calls into one commit.
  function commitWidths() {
    const tr = rowRef.current;
    if (!tr || !onResize) return;
    for (const th of tr.querySelectorAll('th[data-colkey]')) {
      const key = th.dataset.colkey;
      const col = cols.find((c) => c.key === key);
      const min = col?.minWidth || MIN_COL_WIDTH;
      const max = col?.maxWidth || MAX_COL_WIDTH;
      onResize(key, th.offsetWidth, min, max);
    }
  }

  // Once every visible column has a persisted width (i.e. the user has
  // resized), keep the table in the same frozen mode the drag used: fixed
  // layout + explicit total (stored widths + measured utility cells). This is
  // what makes a reload land exactly where the drag ended. With no stored
  // widths (or a newly shown column without one) the styles are cleared and
  // the table returns to the default fluid w-full behavior.
  useEffect(() => {
    const tr = rowRef.current;
    const table = tr?.closest('table');
    if (!table) return;
    const frozen = cols.length > 0 && cols.every((c) => widths?.[c.key]);
    if (!frozen) {
      table.style.tableLayout = '';
      table.style.width = '';
      return;
    }
    let total = 0;
    for (const th of tr.children) {
      const key = th.dataset.colkey;
      total += key && widths[key] ? widths[key] : th.offsetWidth;
    }
    table.style.tableLayout = 'fixed';
    table.style.width = `${total}px`;
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[horizontalOnly]}
    >
      <SortableContext items={cols.map((c) => c.key)} strategy={rectSortingStrategy}>
        <tr ref={rowRef} className={trClassName}>
          {leading}
          {cols.map((c) => (
            <SortableTh
              key={c.key}
              col={c}
              className={thClassName ? thClassName(c) : ''}
              sort={sort}
              onSort={onSort}
              width={widths?.[c.key]}
              resizable={!!onResize}
              onResizeEnd={commitWidths}
            />
          ))}
          {children}
        </tr>
      </SortableContext>
    </DndContext>
  );
}
