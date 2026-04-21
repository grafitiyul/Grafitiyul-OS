import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core';
import { ITEM_KINDS, ITEM_KIND_LABELS, LIST_FILTERS, ANSWER_TYPES } from './config.js';
import { api } from '../../../lib/api.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import PromptDialog from '../../common/PromptDialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import DropIndicator from '../../../dnd/DropIndicator.jsx';
import { useSelection } from '../../../dnd/useSelection.js';
import {
  computeInsertion,
  buildTargetOrder,
} from '../../../dnd/positioning.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bank list pane — sortable tree of folders + items.
//
// Built on the shared DnD primitives in client/src/dnd/ so the same
// layer can be dropped into the flow editor later (recursive groups)
// without refactoring the core logic:
//
//   * positioning.computeInsertion  — decides drop position
//   * DropIndicator                 — thick horizontal drop line
//   * useSelection                  — Ctrl / Cmd / Shift / checkbox
//
// Bank-specific pieces here:
//   * flatten folders+items into a flat row list (the tree is shallow —
//     root → folders → items — but the flat representation is the same
//     one the flow editor will use with deeper trees).
//   * whole-card drag (no ⋮⋮ handle). PointerSensor activation distance
//     keeps clicks from triggering drags.
//   * multi-drag: if the active row is in the current selection, drag
//     ALL selected rows together; else drag just the active row
//     (standard file-manager semantics).
//
// Drop model (Option B — no folder-header drop):
//   * Dragging an ITEM: folder headers are filtered out of the
//     collision pool, so the "over" is always an item row. Cursor
//     above the first item of a folder (below the header) resolves to
//     inserting at index 0 of that folder via computeInsertion's
//     standard above/below midpoint logic.
//   * Dragging a FOLDER: collision pool is limited to folder-header
//     rows; folders reorder at root level only.
// ─────────────────────────────────────────────────────────────────────────────

const COLLAPSE_STORAGE_KEY = 'gos.bank.folderCollapsed';
const UNGROUPED_ID = '__ungrouped__';
const INDENT_PX = 20;

function readCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeCollapsed(next) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function BankListPane({
  content,
  questions,
  folders,
  loading,
  error,
  onRetry,
  onChanged,
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const navigate = useNavigate();
  const { id: selectedId } = useParams();

  // Optimistic local copies for snappy drag feedback.
  const [localContent, setLocalContent] = useState(content);
  const [localQuestions, setLocalQuestions] = useState(questions);
  const [localFolders, setLocalFolders] = useState(folders);
  useEffect(() => {
    setLocalContent((prev) => (sameItemShape(prev, content) ? prev : content));
  }, [content]);
  useEffect(() => {
    setLocalQuestions((prev) =>
      sameItemShape(prev, questions) ? prev : questions,
    );
  }, [questions]);
  useEffect(() => {
    setLocalFolders((prev) =>
      sameFolderShape(prev, folders) ? prev : folders,
    );
  }, [folders]);

  // Scroll preservation across re-renders.
  const scrollRef = useRef(null);
  const savedScrollRef = useRef(0);
  function onScroll(e) {
    savedScrollRef.current = e.currentTarget.scrollTop;
  }
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop !== savedScrollRef.current) {
      el.scrollTop = savedScrollRef.current;
    }
  });

  function toggleFolder(id) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeCollapsed(next);
      return next;
    });
  }

  // ── Build the flat row list in display order. ──
  // Each row is a DnD-ready descriptor that feeds both the renderer and
  // the shared positioning.computeInsertion helper.
  const rows = useMemo(
    () =>
      buildRows({
        folders: localFolders,
        content: localContent,
        questions: localQuestions,
        collapsed,
        search,
        filter,
      }),
    [localFolders, localContent, localQuestions, collapsed, search, filter],
  );

  const rowById = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  // Ordered selectable ids (item rows only — folders are never multi-
  // selectable via the list).
  const selectableIds = useMemo(
    () => rows.filter((r) => r.kind !== 'folder').map((r) => r.id),
    [rows],
  );

  // ── Selection ──
  const sel = useSelection();

  // Clear selection when the filter/search changes if the anchor rolls
  // out of view — keeps anchor + selection consistent.
  useEffect(() => {
    // Intentionally don't clear on navigation — selection persists so
    // the admin can open an item, come back, and still have their
    // multi-selection ready to drag.
  }, []);

  // ── DnD wiring ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const [activeId, setActiveId] = useState(null);
  const [dragKind, setDragKind] = useState(null);
  const [draggingSet, setDraggingSet] = useState(() => new Set());
  const [insertion, setInsertion] = useState(null);
  const pointerYRef = useRef(0);

  // Used by the positioning helper — Bank has no deeper nesting, so
  // the descendants of a folder are its items. This function keeps the
  // shape consumers-of-the-primitive will need when Flow's recursive
  // groups land.
  const descendants = useCallback(
    (id) => {
      const row = rowById.get(id);
      if (!row || !row.isContainer) return null;
      const d = new Set();
      for (const r of rows) {
        if (r.parentId === id) d.add(r.id);
      }
      return d;
    },
    [rows, rowById],
  );

  function onDragStart(event) {
    const id = String(event.active.id);
    const row = rowById.get(id);
    if (!row) return;
    setActiveId(id);
    setDragKind(row.kind === 'folder' ? 'folder' : 'item');
    // Drag set resolution: if the active row is in the selection,
    // drag the whole selection. Otherwise, drag just the active row.
    if (row.kind === 'folder') {
      setDraggingSet(new Set([id]));
    } else {
      setDraggingSet(sel.dragSetFor(id));
    }
    setInsertion(null);
  }

  function onDragMove(event) {
    // Track pointer Y so computeInsertion can decide above/below the
    // row midpoint. dnd-kit's event.delta + initial activator rect is
    // the cleanest way to get an absolute clientY without a window
    // listener.
    const act = event.activatorEvent;
    if (act && typeof act.clientY === 'number') {
      pointerYRef.current = act.clientY + (event.delta?.y || 0);
    }
    updateInsertion(event);
  }

  function onDragOver(event) {
    updateInsertion(event);
  }

  function onDragCancel() {
    setActiveId(null);
    setDragKind(null);
    setDraggingSet(new Set());
    setInsertion(null);
  }

  function updateInsertion(event) {
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) {
      setInsertion(null);
      return;
    }
    const overEl = document.querySelector(`[data-dnd-row="${cssEscape(overId)}"]`);
    const overRect = overEl?.getBoundingClientRect() || null;
    const ins = computeInsertion({
      rows,
      activeIds: draggingSet,
      activeKind: dragKind,
      overId,
      overRect,
      pointerY: pointerYRef.current,
      descendants,
      // Bank-specific policy: root level only holds folders. Items
      // always live inside a folder (or the synthetic ungrouped
      // bucket). The primitive respects this by falling back from
      // "sibling at root" to "first child of container" when a
      // folder header is the hovered row and activeKind is 'item'.
      rootAccepts: ['folder'],
    });
    setInsertion((prev) => (sameInsertion(prev, ins) ? prev : ins));
  }

  async function onDragEnd(event) {
    const movedIds = Array.from(draggingSet);
    const finalInsertion = insertion;
    onDragCancel();
    if (!finalInsertion || movedIds.length === 0) return;

    if (dragKind === 'folder') {
      return commitFolderMove(movedIds[0], finalInsertion);
    }
    return commitItemMove(movedIds, finalInsertion);
  }

  // Folder reorder — simple arrayMove at root level. The id passed here
  // is the DnD row id (kind-prefixed); the DB id lives on meta.
  function commitFolderMove(rowId, ins) {
    if (ins.parentId != null) return; // folders never nest in Bank
    const row = rowById.get(rowId);
    if (!row || row.kind !== 'folder' || row.meta.isUngrouped) return;
    const folderId = row.meta.id;
    const currentIds = localFolders.map((f) => f.id);
    const fromIdx = currentIds.indexOf(folderId);
    if (fromIdx < 0) return;
    const without = currentIds.filter((id) => id !== folderId);
    // The insertion index counts the ungrouped pseudo-row when it's
    // visible. Subtract 1 to get the index among real folders.
    const ungroupedVisible = rows.some(
      (r) => r.kind === 'folder' && r.meta.isUngrouped,
    );
    const adjusted = ungroupedVisible
      ? Math.max(0, ins.indexInParent - 1)
      : ins.indexInParent;
    const targetIdx = Math.max(0, Math.min(adjusted, without.length));
    const nextIds = [
      ...without.slice(0, targetIdx),
      folderId,
      ...without.slice(targetIdx),
    ];
    const nextFolders = nextIds
      .map((id) => localFolders.find((f) => f.id === id))
      .filter(Boolean);
    flushSync(() => setLocalFolders(nextFolders));
    api.folders.reorder(nextIds).catch(() => onChanged?.());
  }

  // Item(s) reorder / move. Handles:
  //   * single-folder reorder
  //   * cross-folder move (single or multiple items)
  //   * multi-select drag
  // All cases resolve to a single atomic reorder POST against the
  // target folder; the endpoint sets folderId + sortOrder in one
  // transaction (see server/src/routes/items.js /reorder).
  function commitItemMove(movedIds, ins) {
    const targetFolderId = ins.parentId === UNGROUPED_ID ? null : ins.parentId;

    // Resolve each moved id to the actual data row (content or
    // question), preserving the order they appeared in the flat list
    // — that's the user's visible multi-select order.
    const movedInDisplayOrder = rows
      .filter((r) => r.kind !== 'folder' && movedIds.includes(r.id))
      .map((r) => r.meta);

    if (movedInDisplayOrder.length === 0) return;

    // Current children of the target folder, in current sort order,
    // excluding any that are being moved (they'll be re-inserted at
    // the insertion index).
    const currentTargetChildren = [
      ...localContent
        .filter((i) => (i.folderId || null) === targetFolderId)
        .map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
      ...localQuestions
        .filter((i) => (i.folderId || null) === targetFolderId)
        .map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
    ].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const finalList = buildTargetOrder({
      targetChildren: currentTargetChildren,
      insertionIndex: ins.indexInParent,
      movedRows: movedInDisplayOrder.map((m) => ({ id: m.id, kind: m.kind })),
    });

    // Project new sortOrder + folderId into per-kind local state.
    const patches = new Map();
    finalList.forEach((row, idx) => {
      patches.set(`${row.kind}:${row.id}`, {
        sortOrder: idx,
        folderId: targetFolderId,
      });
    });

    flushSync(() => {
      setLocalContent((prev) =>
        prev.map((i) => {
          const p = patches.get(`${ITEM_KINDS.CONTENT}:${i.id}`);
          return p ? { ...i, ...p } : i;
        }),
      );
      setLocalQuestions((prev) =>
        prev.map((i) => {
          const p = patches.get(`${ITEM_KINDS.QUESTION}:${i.id}`);
          return p ? { ...i, ...p } : i;
        }),
      );
    });

    api.bankItems
      .reorder(
        finalList.map((r) => ({ kind: r.kind, id: r.id })),
        targetFolderId,
      )
      .catch(() => onChanged?.());
  }

  // ── Folder dialogs ──
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState(null);
  const [deleteFolder, setDeleteFolder] = useState(null);

  async function confirmAddFolder(name) {
    setAddFolderOpen(false);
    await api.folders.create(name);
    onChanged?.();
  }
  async function confirmRename(name) {
    const f = renameFolder;
    setRenameFolder(null);
    if (!f || name === f.name) return;
    await api.folders.update(f.id, { name });
    onChanged?.();
  }
  async function confirmDelete() {
    const f = deleteFolder;
    setDeleteFolder(null);
    if (!f) return;
    await api.folders.remove(f.id);
    onChanged?.();
  }

  // ── Item actions ──
  function openPreview(row) {
    const url = `/preview/${row.kind}/${row.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function createNew(kind) {
    try {
      if (kind === ITEM_KINDS.CONTENT) {
        const created = await api.contentItems.create({ title: '', body: '' });
        onChanged?.();
        navigate(`/admin/procedures/bank/content/${created.id}`);
      } else {
        const created = await api.questionItems.create({
          title: '',
          questionText: '',
          answerType: ANSWER_TYPES.OPEN_TEXT,
          options: [],
        });
        onChanged?.();
        navigate(`/admin/procedures/bank/question/${created.id}`);
      }
    } catch (e) {
      window.alert('יצירה נכשלה: ' + e.message);
    }
  }

  const totalCount = localContent.length + localQuestions.length;
  const visibleItemCount = rows.filter((r) => r.kind !== 'folder').length;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200 space-y-2 bg-white">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש פריט..."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
        <div className="flex gap-2">
          <NewItemMenu onCreate={createNew} />
          <button
            onClick={() => setAddFolderOpen(true)}
            className="text-[12px] border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 rounded-md px-3 py-2"
            title="תיקייה חדשה"
          >
            + תיקייה
          </button>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-md p-1">
          {LIST_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex-1 text-center px-2 py-1 text-[12px] rounded transition ${
                filter === f.key
                  ? 'bg-white shadow-sm text-gray-900 font-semibold'
                  : 'text-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SelectionBar sel={sel} onClear={sel.clear} />
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {loading && totalCount === 0 && localFolders.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
        )}
        {error && !loading && (
          <div className="p-6 text-center">
            <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
            <div className="text-xs text-gray-500 mb-3 font-mono" dir="ltr">
              {error}
            </div>
            <button
              onClick={onRetry}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
            >
              נסו שוב
            </button>
          </div>
        )}
        {!loading && !error && totalCount === 0 && localFolders.length === 0 && (
          <EmptyListState />
        )}
        {!error && totalCount > 0 && visibleItemCount === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">
            לא נמצאו פריטים תואמים.
          </div>
        )}

        {!error && (totalCount > 0 || localFolders.length > 0) && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <RowsRenderer
              rows={rows}
              insertion={insertion}
              activeId={activeId}
              draggingSet={draggingSet}
              dragKind={dragKind}
              selectedIds={sel.selected}
              selectableIds={selectableIds}
              selectedFlowRoute={selectedId}
              collapsed={collapsed}
              onToggleFolder={toggleFolder}
              onOpen={(row) =>
                navigate(`/admin/procedures/bank/${row.kind}/${row.id}`)
              }
              onSelectClick={(id, mods) =>
                sel.handleClick(id, mods, selectableIds)
              }
              onToggleSelect={sel.toggle}
              onPreview={openPreview}
              onRenameFolder={(f) => setRenameFolder(f)}
              onDeleteFolder={(f) => setDeleteFolder(f)}
            />
            <DragOverlay dropAnimation={null}>
              {activeId && dragKind === 'item' ? (
                <DragGhost
                  count={draggingSet.size}
                  sampleRow={rowById.get(activeId)}
                />
              ) : activeId && dragKind === 'folder' ? (
                <FolderGhost row={rowById.get(activeId)} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <PromptDialog
        open={addFolderOpen}
        title="תיקייה חדשה"
        label="שם"
        placeholder="למשל: תהליכי קבלה, הדרכות חובה"
        confirmLabel="צור"
        onClose={() => setAddFolderOpen(false)}
        onSubmit={confirmAddFolder}
      />
      <PromptDialog
        open={!!renameFolder}
        title="שינוי שם התיקייה"
        label="שם"
        initialValue={renameFolder?.name || ''}
        confirmLabel="שמור"
        onClose={() => setRenameFolder(null)}
        onSubmit={confirmRename}
      />
      <ConfirmDialog
        open={!!deleteFolder}
        title="מחיקת תיקייה"
        body={
          deleteFolder
            ? `למחוק את התיקייה "${deleteFolder.name}"? הפריטים יעברו לרמה הבסיסית.`
            : ''
        }
        confirmLabel="מחק"
        danger
        onCancel={() => setDeleteFolder(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flat-row construction
// ─────────────────────────────────────────────────────────────────────────────

function buildRows({ folders, content, questions, collapsed, search, filter }) {
  const q = search.trim().toLowerCase();
  const matches = (item, kind) => {
    if (filter !== 'all' && kind !== filter) return false;
    if (!q) return true;
    return titleToPlain(item.title).toLowerCase().includes(q);
  };

  // Group items by folder.
  const byFolder = new Map();
  byFolder.set(UNGROUPED_ID, []);
  for (const f of folders) byFolder.set(f.id, []);

  const push = (item, kind) => {
    const fid = item.folderId || UNGROUPED_ID;
    const bucket = byFolder.get(fid) || byFolder.get(UNGROUPED_ID);
    bucket.push({ ...item, kind });
  };
  for (const i of content) push(i, ITEM_KINDS.CONTENT);
  for (const i of questions) push(i, ITEM_KINDS.QUESTION);
  for (const bucket of byFolder.values()) {
    bucket.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  const rows = [];

  const emitFolder = (folder, isUngrouped) => {
    const children = (byFolder.get(folder.id) || []).filter((i) =>
      matches(i, i.kind),
    );
    // Hide ungrouped header if there are no children there and the
    // folder is the synthetic "ungrouped" bucket — avoids a floating
    // "ללא תיקייה" row at the bottom of the list for clean workspaces.
    if (isUngrouped && children.length === 0 && folders.length > 0) return;

    const isCollapsed = !!collapsed[folder.id];
    rows.push({
      id: rowId('folder', folder.id),
      parentId: null,
      depth: 0,
      kind: 'folder',
      isContainer: true,
      acceptsKinds: ['item'],
      collapsed: isCollapsed,
      meta: {
        id: folder.id,
        name: folder.name,
        isUngrouped,
        childCount: children.length,
      },
    });
    if (!isCollapsed) {
      for (const child of children) {
        rows.push({
          id: rowId(child.kind, child.id),
          parentId: folder.id, // parentId is the raw folder id (items
                               // reference folderId, not the row-prefixed id)
          depth: 1,
          kind: 'item',
          isContainer: false,
          acceptsKinds: [],
          collapsed: false,
          meta: child, // full item payload
        });
      }
    }
  };

  // Ungrouped bucket first (no pseudo-folder row unless there are items
  // AND folders — see emitFolder guard).
  emitFolder({ id: UNGROUPED_ID, name: 'ללא תיקייה' }, true);
  for (const f of folders) emitFolder(f, false);

  return rows;
}

// Row ids carry kind as prefix so folder/item id collisions can't
// happen and the DnD layer can read kind without a lookup.
function rowId(kind, id) {
  return `${kind}::${id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

function RowsRenderer({
  rows,
  insertion,
  activeId,
  draggingSet,
  dragKind,
  selectedIds,
  selectableIds,
  selectedFlowRoute,
  collapsed,
  onToggleFolder,
  onOpen,
  onSelectClick,
  onToggleSelect,
  onPreview,
  onRenameFolder,
  onDeleteFolder,
}) {
  // Compute where (if anywhere) to inject the drop indicator. If the
  // insertion's flatIndex is at the end, we render the indicator after
  // the last row.
  return (
    <ul className="py-1 relative">
      {rows.map((row, i) => (
        <Fragment key={row.id}>
          {insertion?.flatIndex === i && (
            <li className="list-none">
              <DropIndicator depth={insertion.depth} indent={INDENT_PX} />
            </li>
          )}
          <RowNode
            row={row}
            isActive={draggingSet.has(row.id)}
            isDragSource={activeId === row.id}
            isSelected={selectedIds.has(row.id)}
            isRouteSelected={
              row.kind !== 'folder' && row.meta.id === selectedFlowRoute
            }
            onToggleFolder={onToggleFolder}
            onOpen={onOpen}
            onSelectClick={onSelectClick}
            onToggleSelect={onToggleSelect}
            onPreview={onPreview}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
          />
        </Fragment>
      ))}
      {insertion?.flatIndex === rows.length && (
        <li className="list-none">
          <DropIndicator depth={insertion.depth} indent={INDENT_PX} />
        </li>
      )}
    </ul>
  );
}

function RowNode({
  row,
  isActive,
  isDragSource,
  isSelected,
  isRouteSelected,
  onToggleFolder,
  onOpen,
  onSelectClick,
  onToggleSelect,
  onPreview,
  onRenameFolder,
  onDeleteFolder,
}) {
  if (row.kind === 'folder') {
    return (
      <FolderRow
        row={row}
        isDragSource={isDragSource}
        onToggleFolder={onToggleFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
      />
    );
  }
  return (
    <ItemRow
      row={row}
      isActive={isActive}
      isDragSource={isDragSource}
      isSelected={isSelected}
      isRouteSelected={isRouteSelected}
      onOpen={onOpen}
      onSelectClick={onSelectClick}
      onToggleSelect={onToggleSelect}
      onPreview={onPreview}
    />
  );
}

// ── Folder row ──
// Whole row is draggable (for folder reorder) AND droppable (as a drop
// target for items landing in this folder). Folder-folder collisions
// resolve at the container level via acceptsKinds.

function FolderRow({
  row,
  isDragSource,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
}) {
  const { meta, collapsed } = row;
  const isUngrouped = meta.isUngrouped;

  // Folder drag handle (for folder reorder). Ungrouped bucket is never
  // draggable and never a drop target for other folders.
  const drag = useDraggable({
    id: row.id,
    disabled: isUngrouped,
    data: { kind: 'folder' },
  });
  // Droppable area for items landing into this folder. The computeInsertion
  // helper distinguishes top-half vs bottom-half so Option B works
  // cleanly — dropping on the folder header area resolves to either
  // "above this folder" or "into this folder at top", both rendered as
  // a line above or below the header.
  const drop = useDroppable({
    id: row.id,
    data: { kind: 'folder-header' },
  });

  return (
    <li
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      data-dnd-row={row.id}
      className={`border-b border-gray-100 ${isDragSource ? 'opacity-40' : ''}`}
      {...(isUngrouped ? {} : drag.attributes)}
      {...(isUngrouped ? {} : drag.listeners)}
      style={{ touchAction: isUngrouped ? 'auto' : 'none' }}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 select-none">
        <button
          onClick={() => onToggleFolder(meta.id)}
          className="flex-1 text-right flex items-center gap-2 text-sm font-semibold text-gray-800"
        >
          <span
            className="text-[11px] text-gray-500"
            style={{
              display: 'inline-block',
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 0.12s',
            }}
          >
            ▼
          </span>
          <span className="truncate">{meta.name}</span>
          <span className="text-[11px] text-gray-500 font-normal">
            ({meta.childCount})
          </span>
        </button>
        {!isUngrouped && (
          <>
            <button
              onClick={() => onRenameFolder({ id: meta.id, name: meta.name })}
              className="text-[11px] text-gray-500 hover:bg-gray-200 rounded px-2 py-0.5"
              title="שנה שם"
            >
              ✎
            </button>
            <button
              onClick={() => onDeleteFolder({ id: meta.id, name: meta.name })}
              className="text-[11px] text-red-600 hover:bg-red-50 rounded px-2 py-0.5"
              title="מחק תיקייה"
            >
              ×
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ── Item row ──
// Whole card is draggable (no ⋮⋮ handle). Clicks open the editor;
// Ctrl/Cmd/Shift clicks manage selection; checkbox toggles selection
// explicitly for touch/mouse without modifiers.

function ItemRow({
  row,
  isActive,
  isDragSource,
  isSelected,
  isRouteSelected,
  onOpen,
  onSelectClick,
  onToggleSelect,
  onPreview,
}) {
  const drag = useDraggable({
    id: row.id,
    data: { kind: 'item' },
  });
  const drop = useDroppable({
    id: row.id,
    data: { kind: 'item' },
  });

  const item = row.meta;

  function onRowClick(e) {
    // Modifier click routes to selection; plain click opens the editor.
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onSelectClick(row.id, {
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
      });
      return;
    }
    onOpen({ kind: item.kind, id: item.id });
  }

  function onCheckboxClick(e) {
    e.stopPropagation();
  }
  function onCheckboxChange() {
    onToggleSelect(row.id);
  }

  return (
    <li
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      data-dnd-row={row.id}
      className={`border-b border-gray-100 select-none ${
        isActive ? 'opacity-40' : ''
      }`}
      {...drag.attributes}
      {...drag.listeners}
      style={{ touchAction: 'none' }}
      onClick={onRowClick}
    >
      <div
        className={`flex items-center gap-2 py-2 pe-2 ps-3 transition ${
          isRouteSelected
            ? 'bg-blue-50'
            : isSelected
            ? 'bg-blue-50/60'
            : 'hover:bg-gray-50'
        }`}
        style={{ paddingInlineStart: INDENT_PX + 12 }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onCheckboxChange}
          onClick={onCheckboxClick}
          className="shrink-0 cursor-pointer"
          aria-label="סימון פריט לפעולה מרובה"
        />
        <span
          className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded leading-tight ${
            item.kind === ITEM_KINDS.QUESTION
              ? 'bg-amber-100 text-amber-800'
              : 'bg-blue-100 text-blue-800'
          }`}
        >
          {ITEM_KIND_LABELS[item.kind]}
        </span>
        <TitleHtml
          html={item.title}
          className="flex-1 min-w-0 font-medium text-gray-900 truncate"
        />
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onPreview({ kind: item.kind, id: item.id });
          }}
          className="shrink-0 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded p-1"
          title="תצוגה מקדימה"
          aria-label="תצוגה מקדימה"
        >
          <EyeIcon />
        </button>
      </div>
    </li>
  );
}

function TitleHtml({ html, className }) {
  const safe = html && /<[a-z]/i.test(html) ? html : null;
  if (safe) {
    return (
      <span
        className={`gos-prose ${className || ''}`}
        dir="rtl"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  }
  return <span className={className}>{titleToPlain(html) || '(ללא כותרת)'}</span>;
}

// ── Drag overlay ──
function DragGhost({ count, sampleRow }) {
  const label =
    count > 1
      ? `${count} פריטים`
      : sampleRow
      ? titleToPlain(sampleRow.meta.title) || '(ללא כותרת)'
      : '';
  return (
    <div className="bg-white border-2 border-blue-400 rounded-md shadow-lg px-3 py-2 text-sm font-medium text-gray-900 pointer-events-none min-w-[120px]">
      {count > 1 && (
        <span className="inline-block bg-blue-600 text-white text-[10px] font-semibold rounded-full px-2 py-0.5 me-2">
          {count}
        </span>
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}
function FolderGhost({ row }) {
  return (
    <div className="bg-white border-2 border-blue-400 rounded-md shadow-lg px-3 py-2 text-sm font-semibold text-gray-800 pointer-events-none min-w-[120px]">
      📁 {row?.meta?.name || ''}
    </div>
  );
}

// ── Selection header bar ──
function SelectionBar({ sel, onClear }) {
  if (sel.size === 0) return null;
  return (
    <div className="flex items-center gap-2 text-[12px] bg-blue-50 border border-blue-200 text-blue-800 rounded px-2 py-1">
      <span className="font-medium">{sel.size} נבחרו</span>
      <span className="flex-1" />
      <button
        onClick={onClear}
        className="text-blue-700 hover:bg-blue-100 rounded px-2 py-0.5"
      >
        נקה
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function sameItemShape(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      (x.sortOrder ?? 0) !== (y.sortOrder ?? 0) ||
      (x.folderId || null) !== (y.folderId || null) ||
      (x.title || '') !== (y.title || '')
    ) {
      return false;
    }
  }
  return true;
}
function sameFolderShape(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      (x.sortOrder ?? 0) !== (y.sortOrder ?? 0) ||
      (x.name || '') !== (y.name || '')
    ) {
      return false;
    }
  }
  return true;
}

function sameInsertion(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.parentId === b.parentId &&
    a.indexInParent === b.indexInParent &&
    a.flatIndex === b.flatIndex &&
    a.depth === b.depth
  );
}

// CSS.escape polyfill wrapper — modern browsers have it; just in case.
function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(s);
  }
  return String(s).replace(/([^a-zA-Z0-9_\-])/g, '\\$1');
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons / small UI
// ─────────────────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EmptyListState() {
  return (
    <div className="p-6 text-center max-w-xs mx-auto">
      <div className="text-4xl mb-3 opacity-50">☷</div>
      <div className="font-semibold text-gray-800 mb-1">עדיין אין פריטים בבנק</div>
      <div className="text-sm text-gray-500">
        השתמשו בכפתור "+ חדש" כדי ליצור פריט ראשון.
      </div>
    </div>
  );
}

function NewItemMenu({ onCreate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function choose(kind) {
    setOpen(false);
    onCreate(kind);
  }

  return (
    <div className="relative flex-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium flex items-center justify-between"
      >
        <span>+ חדש</span>
        <span className="text-[10px]">▼</span>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
          <button
            onClick={() => choose(ITEM_KINDS.CONTENT)}
            className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
          >
            + תוכן חדש
          </button>
          <button
            onClick={() => choose(ITEM_KINDS.QUESTION)}
            className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
          >
            + שאלה חדשה
          </button>
        </div>
      )}
    </div>
  );
}
