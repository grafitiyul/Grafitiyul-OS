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
  MeasuringStrategy,
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
// Bank list pane — nested folders, drill-down navigation.
//
// Single tree (parentId-based) for folders, folderId on items. The view
// shows ONE folder's direct children at a time: enter a folder to drill in,
// click breadcrumb to drill out. No inline collapse/expand — only
// context-switching navigation. This is the Finder/Explorer mental model
// and is the mode the spec asked for.
//
// DnD built on the shared primitives in client/src/dnd/:
//   * positioning.computeInsertion  — drop position
//   * DropIndicator                 — horizontal line between rows
//   * useSelection                  — Ctrl / Cmd / Shift / checkbox
//
// Cross-level moves via drag are supported by breadcrumb drop targets:
// dragging onto "הבנק" moves to root; dragging onto an ancestor moves
// into that ancestor's children.
//
// The folder-drag path and item-drag path share the same pipeline. Only
// the persistence call differs (PUT /api/items/reorder for items,
// PUT /api/items/folders/reorder or PUT /folders/:id for folders).
// ─────────────────────────────────────────────────────────────────────────────

const INDENT_PX = 20;
const BREADCRUMB_PREFIX = 'breadcrumb::';
const BREADCRUMB_ROOT_ID = BREADCRUMB_PREFIX + 'root';

export default function BankListPane({
  content,
  questions,
  folders,
  loading,
  error,
  onRetry,
  onChanged,
  currentFolderId,
  onEnterFolder,
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
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
  // Reset scroll on folder change so entering a new folder starts from the
  // top — persistence is per-folder view, not global.
  useEffect(() => {
    savedScrollRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentFolderId]);

  // Folder lookups — used for breadcrumb path + descendants computation.
  const folderById = useMemo(() => {
    const m = new Map();
    for (const f of localFolders) m.set(f.id, f);
    return m;
  }, [localFolders]);

  const folderChildrenIds = useMemo(() => {
    const m = new Map();
    for (const f of localFolders) {
      const key = f.parentId || null;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(f.id);
    }
    return m;
  }, [localFolders]);

  function folderDescendantIds(folderId) {
    const result = new Set();
    const stack = [folderId];
    while (stack.length) {
      const cur = stack.pop();
      const kids = folderChildrenIds.get(cur) || [];
      for (const k of kids) {
        if (!result.has(k)) {
          result.add(k);
          stack.push(k);
        }
      }
    }
    return result;
  }

  // Breadcrumb path: root → ... → currentFolder (exclusive of root).
  const breadcrumbPath = useMemo(() => {
    if (!currentFolderId) return [];
    const path = [];
    let cur = currentFolderId;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const f = folderById.get(cur);
      if (!f) break;
      path.unshift(f);
      cur = f.parentId || null;
    }
    return path;
  }, [currentFolderId, folderById]);

  // If currentFolderId is stale (folder was deleted), bounce back to
  // root. We don't surface an error — the URL simply points at nothing
  // anymore.
  useEffect(() => {
    if (!currentFolderId) return;
    if (!folderById.has(currentFolderId)) {
      onEnterFolder(null);
    }
  }, [currentFolderId, folderById, onEnterFolder]);

  // ── Build the visible flat row list. ──
  // Drill-down: rows are just the current folder's direct children.
  // Folders first (like Finder), then items.
  const rows = useMemo(() => {
    return buildVisibleRows({
      currentFolderId,
      folders: localFolders,
      content: localContent,
      questions: localQuestions,
      search,
      filter,
    });
  }, [currentFolderId, localFolders, localContent, localQuestions, search, filter]);

  const rowById = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const selectableIds = useMemo(
    () => rows.filter((r) => r.kind !== 'folder').map((r) => r.id),
    [rows],
  );

  const sel = useSelection();

  // ── DnD wiring ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const [activeId, setActiveId] = useState(null);
  const [dragKind, setDragKind] = useState(null);
  const [draggingSet, setDraggingSet] = useState(() => new Set());
  const [insertion, setInsertion] = useState(null);
  const [breadcrumbOver, setBreadcrumbOver] = useState(null);

  // Authoritative pointer-Y tracking. Subscribing to window pointermove
  // is the only reliable way to know the current cursor position during
  // a drag — dnd-kit's `event.delta` is supposed to give the same thing
  // but has timing edge cases (batched events, sensor quirks) that can
  // leave us reading 0 and collapsing every drop to "above the over
  // item". The window listener is O(1) per move and we only ever read
  // the ref synchronously, so there's no perf concern.
  const pointerYRef = useRef(0);
  useEffect(() => {
    function onPointer(e) {
      pointerYRef.current = e.clientY;
    }
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  // Cycle-prevention resolver for computeInsertion. Folders can nest;
  // dropping a folder into its own subtree is rejected.
  const descendants = useCallback(
    (dndId) => {
      if (!dndId?.startsWith('folder::')) return null;
      const id = dndId.slice('folder::'.length);
      const descFolderIds = folderDescendantIds(id);
      const s = new Set();
      s.add(dndId);
      for (const d of descFolderIds) s.add(`folder::${d}`);
      return s;
    },
    [folderChildrenIds], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function onDragStart(event) {
    const id = String(event.active.id);
    const row = rowById.get(id);
    if (!row) return;
    setActiveId(id);
    setDragKind(row.kind === 'folder' ? 'folder' : 'item');
    if (row.kind === 'folder') {
      setDraggingSet(new Set([id]));
    } else {
      setDraggingSet(sel.dragSetFor(id));
    }
    setInsertion(null);
    setBreadcrumbOver(null);
  }

  // The window pointermove listener keeps pointerYRef authoritative —
  // these handlers just need to recompute the insertion whenever dnd-kit
  // tells us something relevant changed.
  function onDragMove(event) {
    updateOver(event);
  }
  function onDragOver(event) {
    updateOver(event);
  }

  function onDragCancel() {
    setActiveId(null);
    setDragKind(null);
    setDraggingSet(new Set());
    setInsertion(null);
    setBreadcrumbOver(null);
  }

  function updateOver(event) {
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) {
      setInsertion(null);
      setBreadcrumbOver(null);
      return;
    }
    if (overId.startsWith(BREADCRUMB_PREFIX)) {
      // Breadcrumb drop — not a row-level insertion. Just remember
      // which segment is hot so the UI can highlight it.
      setInsertion(null);
      setBreadcrumbOver(overId);
      return;
    }
    setBreadcrumbOver(null);
    const overEl = document.querySelector(
      `[data-dnd-row="${cssEscape(overId)}"]`,
    );
    const overRect = overEl?.getBoundingClientRect() || null;
    const ins = computeInsertion({
      rows,
      activeIds: draggingSet,
      activeKind: dragKind,
      overId,
      overRect,
      pointerY: pointerYRef.current,
      descendants,
      // In drill-down the visible rows are the direct children of the
      // current folder. Both items and folders can live here, so root
      // accepts everything. (The actual target folder is resolved in
      // commit by treating parentId=null as "currentFolderId".)
      rootAccepts: null,
    });
    setInsertion((prev) => (sameInsertion(prev, ins) ? prev : ins));
  }

  function onDragEnd(event) {
    // Snapshot everything BEFORE clearing drag state. Relying on the
    // state variables after calling the clear helper is fragile — React
    // async state means they'd still be the old values inside this
    // tick, but under concurrent rendering that guarantee can break.
    // A local snapshot is zero-cost and removes the class of bugs.
    const snapshotKind = dragKind;
    const snapshotMovedIds = Array.from(draggingSet);
    const snapshotInsertion = insertion;
    const overId = event.over?.id ? String(event.over.id) : null;

    // Commit the reorder first so the optimistic DOM update happens
    // while dnd-kit is still tearing down the overlay — the user sees
    // the row appear in its new position immediately, no visible gap.
    if (snapshotMovedIds.length > 0) {
      if (overId && overId.startsWith(BREADCRUMB_PREFIX)) {
        const target =
          overId === BREADCRUMB_ROOT_ID
            ? null
            : overId.slice(BREADCRUMB_PREFIX.length);
        if (snapshotKind === 'folder') {
          const f = snapshotMovedIds[0];
          if (f) {
            const id = f.slice('folder::'.length);
            const cycle =
              target &&
              (id === target || folderDescendantIds(id).has(target));
            if (!cycle) commitFolderMoveToParent(id, target);
          }
        } else {
          commitItemsMoveToFolder(snapshotMovedIds, target);
        }
      } else if (snapshotInsertion) {
        if (snapshotKind === 'folder') {
          commitFolderMove(snapshotMovedIds[0], snapshotInsertion);
        } else {
          commitItemMove(snapshotMovedIds, snapshotInsertion);
        }
      }
    }

    // Clear drag state last so the original row's opacity-40 stays in
    // place until the flushSync'd optimistic update has already moved
    // it. No ghost-in-old-position flash.
    onDragCancel();
  }

  // ── Commit helpers ──

  // Folder reorder/move. One path for BOTH same-parent reorder and
  // cross-parent move: build the target parent's ordered children with
  // the dragged folder inserted at the computed index, then call the
  // atomic reorder endpoint (it sets parentId + sortOrder in one
  // transaction for every entry).
  //
  // ins.parentId is null when the drop lands at the current view's
  // level (siblings of the visible folders) and non-null when the drop
  // lands INTO a visible sub-folder.
  function commitFolderMove(rowId, ins) {
    const row = rowById.get(rowId);
    if (!row || row.kind !== 'folder') return;
    const folderId = row.meta.id;
    const targetParentId =
      ins.parentId == null ? currentFolderId || null : ins.parentId;

    // Drop at current-view level → index is among VISIBLE folder rows
    // (items sit after folders in the view, so the first N visible
    // rows are folders). Drop INTO a visible sub-folder → index is 0
    // (computeInsertion always returns 0 for "first child of over").
    let insertIdx;
    if (ins.parentId == null) {
      const visibleFolderIds = rows
        .filter((r) => r.kind === 'folder' && r.id !== rowId)
        .map((r) => r.meta.id);
      const neighbour = visibleFolderIds[ins.indexInParent];
      insertIdx = neighbour != null ? indexInSiblingFolders(neighbour) : -1;
      if (insertIdx < 0) insertIdx = siblingFolderCount(targetParentId);
    } else {
      insertIdx = ins.indexInParent;
    }
    commitFolderMoveAt(folderId, targetParentId, insertIdx);
  }

  function commitFolderMoveToParent(folderId, targetParentId) {
    // Breadcrumb drop or explicit "move to ancestor" — append at end.
    commitFolderMoveAt(folderId, targetParentId, siblingFolderCount(targetParentId));
  }

  function commitFolderMoveAt(folderId, targetParentId, insertIdx) {
    if (dragFolderCreatesCycle(folderId, targetParentId)) return;
    const siblings = localFolders
      .filter((f) => (f.parentId || null) === (targetParentId || null))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const siblingIds = siblings.map((f) => f.id).filter((id) => id !== folderId);
    const clampedIdx = Math.max(0, Math.min(insertIdx, siblingIds.length));
    const nextIds = [
      ...siblingIds.slice(0, clampedIdx),
      folderId,
      ...siblingIds.slice(clampedIdx),
    ];
    flushSync(() => {
      setLocalFolders((prev) =>
        prev.map((f) => {
          const idx = nextIds.indexOf(f.id);
          if (idx < 0) return f;
          return { ...f, parentId: targetParentId || null, sortOrder: idx };
        }),
      );
    });
    api.folders.reorder(nextIds, targetParentId).catch(() => onChanged?.());
  }

  function siblingFolderCount(parentId) {
    return localFolders.filter(
      (f) => (f.parentId || null) === (parentId || null),
    ).length;
  }
  function indexInSiblingFolders(folderId) {
    const f = folderById.get(folderId);
    if (!f) return -1;
    const siblings = localFolders
      .filter((x) => (x.parentId || null) === (f.parentId || null))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return siblings.findIndex((x) => x.id === folderId);
  }

  function dragFolderCreatesCycle(folderId, targetParentId) {
    if (!targetParentId) return false;
    if (targetParentId === folderId) return true;
    return folderDescendantIds(folderId).has(targetParentId);
  }

  // Item(s) move within or across folders using the row insertion.
  //
  // parentId=null means "drop at current folder level" → targetFolderId
  // = currentFolderId. Otherwise the visible row is a folder and we're
  // dropping INTO that folder.
  function commitItemMove(movedIds, ins) {
    const targetFolderId =
      ins.parentId == null ? currentFolderId || null : ins.parentId;

    const movedInDisplayOrder = rows
      .filter((r) => r.kind !== 'folder' && movedIds.includes(r.id))
      .map((r) => r.meta);
    if (movedInDisplayOrder.length === 0) return;

    const currentTargetChildren = [
      ...localContent
        .filter((i) => (i.folderId || null) === targetFolderId)
        .map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
      ...localQuestions
        .filter((i) => (i.folderId || null) === targetFolderId)
        .map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
    ].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // Remap indexInParent: in the visible view the index counts folders
    // + items; in the target folder it only counts items. If dropping
    // into a sub-folder (parentId is a folder id), the index is already
    // relative to that folder's children (and folder-target children are
    // items only in the visible world — our flat representation shows
    // only one level). If dropping at current level (parentId=null), we
    // subtract the number of leading folders in the visible list.
    let insertionIndex = ins.indexInParent;
    if (ins.parentId == null) {
      const visibleFolders = rows.filter((r) => r.kind === 'folder').length;
      insertionIndex = Math.max(0, ins.indexInParent - visibleFolders);
    }

    const finalList = buildTargetOrder({
      targetChildren: currentTargetChildren,
      insertionIndex,
      movedRows: movedInDisplayOrder.map((m) => ({ id: m.id, kind: m.kind })),
    });

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

  // Breadcrumb-drop path for items: move all dragged items into the
  // target folder, appended at the end. No index computation — we're
  // explicitly saying "move OUT of here".
  function commitItemsMoveToFolder(movedRowIds, targetFolderId) {
    const movedItems = rows
      .filter((r) => r.kind !== 'folder' && movedRowIds.includes(r.id))
      .map((r) => r.meta);
    if (movedItems.length === 0) return;

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
      insertionIndex: currentTargetChildren.length, // append
      movedRows: movedItems.map((m) => ({ id: m.id, kind: m.kind })),
    });

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
    await api.folders.create(name, currentFolderId || null);
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
    // If we're currently inside the folder being deleted, drill out
    // first so the URL doesn't end up pointing at a ghost.
    if (f.id === currentFolderId) {
      onEnterFolder(f.parentId || null);
    }
    await api.folders.remove(f.id);
    onChanged?.();
  }

  // ── Actions ──
  function openPreview(row) {
    const url = `/preview/${row.kind}/${row.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function createNew(kind) {
    try {
      const folderId = currentFolderId || null;
      if (kind === ITEM_KINDS.CONTENT) {
        const created = await api.contentItems.create({
          title: '',
          body: '',
          folderId,
        });
        onChanged?.();
        navigate(`/admin/procedures/bank/content/${created.id}`);
      } else {
        const created = await api.questionItems.create({
          title: '',
          questionText: '',
          answerType: ANSWER_TYPES.OPEN_TEXT,
          options: [],
          folderId,
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
  const visibleFolderCount = rows.filter((r) => r.kind === 'folder').length;

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
          <NewItemMenu onCreate={createNew} currentFolderId={currentFolderId} />
          <button
            onClick={() => setAddFolderOpen(true)}
            className="text-[12px] border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 rounded-md px-3 py-2"
            title={
              currentFolderId
                ? 'תיקייה חדשה בתוך התיקייה הנוכחית'
                : 'תיקייה חדשה בשורש'
            }
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

        {!error && (totalCount > 0 || localFolders.length > 0) ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            // Force dnd-kit to re-measure droppable rects continuously
            // during a drag. Default is BeforeDragging which captures
            // rects once at drag start — if anything shifts (the drop
            // indicator being injected between rows, scroll, etc.)
            // the "over" detection picks the wrong target. Always is
            // cheap enough at bank-list scale and makes positioning
            // precise.
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <Breadcrumb
              path={breadcrumbPath}
              onEnter={onEnterFolder}
              breadcrumbOver={breadcrumbOver}
              activeDrag={activeId}
            />

            {!loading && visibleFolderCount === 0 && visibleItemCount === 0 && (
              <EmptyFolderState
                isRoot={!currentFolderId}
                hasSearch={!!search}
              />
            )}

            {(visibleFolderCount > 0 || visibleItemCount > 0) && (
              <RowsRenderer
                rows={rows}
                insertion={insertion}
                activeId={activeId}
                draggingSet={draggingSet}
                // When the insertion target is a specific folder (non-null
                // parentId means "drop INTO this folder"), surface it so
                // the folder row renders a highlight ring instead of us
                // showing a horizontal line. Two visual modes, one
                // consistent rule — applies identically to empty and
                // non-empty folders.
                dropIntoFolderId={
                  insertion && insertion.parentId
                    ? insertion.parentId
                    : null
                }
                selectedIds={sel.selected}
                selectableIds={selectableIds}
                selectedFlowRoute={selectedId}
                onEnterFolder={onEnterFolder}
                onOpen={(row) =>
                  navigate(`/admin/procedures/bank/${row.kind}/${row.id}`)
                }
                onSelectClick={(id, mods) =>
                  sel.handleClick(id, mods, selectableIds)
                }
                onToggleSelect={sel.toggle}
                onRenameFolder={(f) => setRenameFolder(f)}
                onDeleteFolder={(f) => setDeleteFolder(f)}
              />
            )}

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
        ) : (
          !loading && !error && <EmptyListState />
        )}
      </div>

      <PromptDialog
        open={addFolderOpen}
        title={currentFolderId ? 'תת-תיקייה חדשה' : 'תיקייה חדשה'}
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
            ? `למחוק את התיקייה "${deleteFolder.name}"? תת-התיקיות והפריטים בתוכה יעברו לרמה הבסיסית.`
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
// Flat-row construction — ONE level of the tree only (drill-down).
// Folders first, items after. Ordered by sortOrder within each group.
// ─────────────────────────────────────────────────────────────────────────────

function buildVisibleRows({
  currentFolderId,
  folders,
  content,
  questions,
  search,
  filter,
}) {
  const q = search.trim().toLowerCase();
  const matchesFolder = (f) => {
    if (!q) return true;
    return (f.name || '').toLowerCase().includes(q);
  };
  const matchesItem = (item, kind) => {
    if (filter !== 'all' && kind !== filter) return false;
    if (!q) return true;
    return titleToPlain(item.title).toLowerCase().includes(q);
  };

  const childFolders = folders
    .filter((f) => (f.parentId || null) === (currentFolderId || null))
    .filter(matchesFolder)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const childContent = content
    .filter((i) => (i.folderId || null) === (currentFolderId || null))
    .map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT }))
    .filter((i) => matchesItem(i, i.kind));
  const childQuestions = questions
    .filter((i) => (i.folderId || null) === (currentFolderId || null))
    .map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION }))
    .filter((i) => matchesItem(i, i.kind));
  const childItems = [...childContent, ...childQuestions].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  const rows = [];
  for (const f of childFolders) {
    rows.push({
      id: rowId('folder', f.id),
      parentId: null,
      depth: 0,
      kind: 'folder',
      isContainer: true,
      acceptsKinds: ['item', 'folder'],
      collapsed: false,
      meta: f,
    });
  }
  for (const item of childItems) {
    rows.push({
      id: rowId(item.kind, item.id),
      parentId: null,
      depth: 0,
      kind: 'item',
      isContainer: false,
      acceptsKinds: [],
      collapsed: false,
      meta: item,
    });
  }
  return rows;
}

function rowId(kind, id) {
  return `${kind}::${id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumb
// ─────────────────────────────────────────────────────────────────────────────

function Breadcrumb({ path, onEnter, breadcrumbOver, activeDrag }) {
  const segments = [
    { id: null, name: 'הבנק', isRoot: true },
    ...path.map((f) => ({ id: f.id, name: f.name })),
  ];
  // The LAST segment is the current location — not a drop target for
  // the current view's own rows (you're already there).
  return (
    <nav
      className="px-3 py-2 text-[12px] border-b border-gray-100 flex items-center gap-1 flex-wrap bg-gray-50/60"
      aria-label="מסלול תיקיות"
    >
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        return (
          <Fragment key={seg.id ?? '__root__'}>
            {idx > 0 && <span className="text-gray-400 mx-0.5">›</span>}
            <BreadcrumbSegment
              seg={seg}
              isLast={isLast}
              isDragging={!!activeDrag}
              breadcrumbOver={breadcrumbOver}
              onEnter={onEnter}
            />
          </Fragment>
        );
      })}
    </nav>
  );
}

function BreadcrumbSegment({ seg, isLast, isDragging, breadcrumbOver, onEnter }) {
  const dropId = seg.id ? BREADCRUMB_PREFIX + seg.id : BREADCRUMB_ROOT_ID;
  const drop = useDroppable({
    id: dropId,
    disabled: isLast, // can't "move here" if already here
  });
  const isHot = breadcrumbOver === dropId;

  const body = (
    <span
      className={`inline-block rounded px-2 py-0.5 transition ${
        isHot
          ? 'bg-blue-500 text-white'
          : isDragging && !isLast
          ? 'bg-white border border-dashed border-blue-300 text-blue-700'
          : isLast
          ? 'text-gray-900 font-semibold'
          : 'text-blue-700 hover:bg-blue-50'
      }`}
    >
      {seg.isRoot ? '🏠 הבנק' : seg.name}
    </span>
  );

  if (isLast) {
    return <span ref={drop.setNodeRef}>{body}</span>;
  }
  return (
    <button
      ref={drop.setNodeRef}
      onClick={() => onEnter(seg.id)}
      className="cursor-pointer"
      type="button"
    >
      {body}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row renderer
// ─────────────────────────────────────────────────────────────────────────────

function RowsRenderer({
  rows,
  insertion,
  activeId,
  draggingSet,
  dropIntoFolderId,
  selectedIds,
  selectableIds,
  selectedFlowRoute,
  onEnterFolder,
  onOpen,
  onSelectClick,
  onToggleSelect,
  onRenameFolder,
  onDeleteFolder,
}) {
  // Show the horizontal line only for "between rows" drops. When the
  // drop is INTO a specific folder, we don't render a line — the
  // folder itself gets highlighted via `isDropTarget`.
  const showLine = insertion && !dropIntoFolderId;
  return (
    <ul className="py-1 relative" style={{ margin: 0, padding: '0.25rem 0' }}>
      {rows.map((row, i) => (
        <Fragment key={row.id}>
          {showLine && insertion.flatIndex === i && (
            <li
              className="list-none"
              style={{ margin: 0, padding: 0, height: 0, lineHeight: 0 }}
            >
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
            isDropTarget={
              row.kind === 'folder' && dropIntoFolderId === row.meta.id
            }
            onEnterFolder={onEnterFolder}
            onOpen={onOpen}
            onSelectClick={onSelectClick}
            onToggleSelect={onToggleSelect}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
          />
        </Fragment>
      ))}
      {showLine && insertion.flatIndex === rows.length && (
        <li
          className="list-none"
          style={{ margin: 0, padding: 0, height: 0, lineHeight: 0 }}
        >
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
  isDropTarget,
  onEnterFolder,
  onOpen,
  onSelectClick,
  onToggleSelect,
  onRenameFolder,
  onDeleteFolder,
}) {
  if (row.kind === 'folder') {
    return (
      <FolderRow
        row={row}
        isActive={isActive}
        isDragSource={isDragSource}
        isDropTarget={isDropTarget}
        onEnterFolder={onEnterFolder}
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
    />
  );
}

// ── Folder row ──
function FolderRow({
  row,
  isActive,
  isDragSource,
  isDropTarget,
  onEnterFolder,
  onRenameFolder,
  onDeleteFolder,
}) {
  const { meta } = row;
  const drag = useDraggable({ id: row.id, data: { kind: 'folder' } });
  const drop = useDroppable({ id: row.id, data: { kind: 'folder' } });

  // Combine the two refs through a stable callback so dnd-kit doesn't
  // re-register the node on every render. Both setNodeRef returns are
  // stable identities, but the combining closure would otherwise be a
  // new function each render.
  const setRef = useCallback(
    (el) => {
      drag.setNodeRef(el);
      drop.setNodeRef(el);
    },
    [drag.setNodeRef, drop.setNodeRef],
  );

  function onClick(e) {
    // Avoid entering on modifier clicks — reserved for future
    // multi-select of folders if we ever add it.
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    onEnterFolder(meta.id);
  }

  return (
    <li
      ref={setRef}
      data-dnd-row={row.id}
      className={`border-b border-gray-100 select-none ${
        isActive ? 'opacity-40' : ''
      }`}
      {...drag.attributes}
      {...drag.listeners}
      style={{ touchAction: 'none' }}
      onClick={onClick}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition ${
          isDropTarget
            ? 'bg-blue-100 ring-2 ring-inset ring-blue-500'
            : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <span className="shrink-0 text-[15px]">📁</span>
        <span className="flex-1 truncate text-sm font-semibold text-gray-800">
          {meta.name}
        </span>
        <span className="text-gray-400 text-[12px]">›</span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRenameFolder({ id: meta.id, name: meta.name });
          }}
          className="text-[11px] text-gray-500 hover:bg-gray-200 rounded px-2 py-0.5"
          title="שנה שם"
        >
          ✎
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFolder({ id: meta.id, name: meta.name });
          }}
          className="text-[11px] text-red-600 hover:bg-red-50 rounded px-2 py-0.5"
          title="מחק תיקייה"
        >
          ×
        </button>
      </div>
    </li>
  );
}

// ── Item row ──
function ItemRow({
  row,
  isActive,
  isDragSource,
  isSelected,
  isRouteSelected,
  onOpen,
  onSelectClick,
  onToggleSelect,
}) {
  const drag = useDraggable({ id: row.id, data: { kind: 'item' } });
  const drop = useDroppable({ id: row.id, data: { kind: 'item' } });
  const setRef = useCallback(
    (el) => {
      drag.setNodeRef(el);
      drop.setNodeRef(el);
    },
    [drag.setNodeRef, drop.setNodeRef],
  );

  const item = row.meta;

  function onRowClick(e) {
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
      ref={setRef}
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
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onCheckboxChange}
          onClick={onCheckboxClick}
          onPointerDown={(e) => e.stopPropagation()}
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

// ── Drag ghosts ──
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
// Empty states
// ─────────────────────────────────────────────────────────────────────────────
function EmptyFolderState({ isRoot, hasSearch }) {
  if (hasSearch) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        לא נמצאו פריטים תואמים.
      </div>
    );
  }
  return (
    <div className="p-10 text-center text-sm text-gray-500 max-w-xs mx-auto">
      {isRoot ? (
        <>עדיין אין פריטים או תיקיות. התחילו בלחיצה על "+ חדש" או "+ תיקייה".</>
      ) : (
        <>התיקייה ריקה. הוסיפו פריטים או תת-תיקייה באמצעות הכפתורים למעלה.</>
      )}
    </div>
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
      (x.parentId || null) !== (y.parentId || null) ||
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
function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(s);
  }
  return String(s).replace(/([^a-zA-Z0-9_\-])/g, '\\$1');
}

// ─────────────────────────────────────────────────────────────────────────────
// "+ new" menu
// ─────────────────────────────────────────────────────────────────────────────
function NewItemMenu({ onCreate, currentFolderId }) {
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
        title={
          currentFolderId
            ? 'יוצר פריט חדש בתוך התיקייה הנוכחית'
            : 'יוצר פריט חדש בשורש'
        }
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
