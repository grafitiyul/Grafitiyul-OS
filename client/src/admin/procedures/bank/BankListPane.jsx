import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { ITEM_KINDS, ITEM_KIND_LABELS, LIST_FILTERS } from './config.js';
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
    setLocalFolders((prev) => {
      const same = sameFolderShape(prev, folders);
      if (!same) {
        // This is the only path (besides the drag-commit setState)
        // that replaces localFolders. If the user reports a folder
        // "reverting" after a drop, this log tells us whether the
        // revert came from here — i.e., a refresh replaced the
        // optimistic state.
        console.log('[bank-dnd] folders prop differs — replacing local', {
          prevCount: prev?.length,
          nextCount: folders?.length,
        });
      }
      return same ? prev : folders;
    });
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

  // Every visible row — folder or item — is selectable. Folders get a
  // checkbox + modifier-click handling just like items. Mixed selection
  // (folders + items together) is supported end-to-end.
  const selectableIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const sel = useSelection();

  // Clearing selection when the user navigates into a different folder
  // removes the mental-model cliff of "I had things selected but they're
  // not here anymore" — selection that spans views is confusing.
  useEffect(() => {
    sel.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

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

    // Drag-set resolution is done HERE, directly against the live
    // selection set, to avoid closure staleness. Rule (file-manager
    // standard): if the dragged row is in the current selection, drag
    // the whole selection; otherwise drag just this one row (and do
    // not mutate the selection). The selection can contain folders
    // AND items (mixed), so `dragKind` tracks the ACTIVE row's kind
    // only — it's used for UX polish (overlay style, empty-slot
    // checks), not for filtering the drag set.
    let dragSet;
    if (sel.selected.has(id)) {
      dragSet = new Set(sel.selected);
    } else {
      dragSet = new Set([id]);
    }

    setActiveId(id);
    setDragKind(row.kind === 'folder' ? 'folder' : 'item');
    setDraggingSet(dragSet);
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
    const snapshotMovedIds = Array.from(draggingSet);
    const snapshotInsertion = insertion;
    const overId = event.over?.id ? String(event.over.id) : null;

    // Diagnostics — safe to leave in prod; trivially cheap and gives
    // us a clear trace when a drag misbehaves. Filter by [bank-dnd] in
    // the browser console.
    console.log('[bank-dnd] onDragEnd', {
      movedIds: snapshotMovedIds,
      insertion: snapshotInsertion,
      overId,
      dragKind,
      currentFolderId,
    });

    onDragCancel();

    if (snapshotMovedIds.length === 0) return;

    // Split dragged rows by kind. Selection (and therefore draggingSet)
    // can contain folders, items, or both — one commit path for all.
    const folderDbIds = [];
    const itemRowIds = [];
    for (const rowId of snapshotMovedIds) {
      const row = rowById.get(rowId);
      if (!row) continue;
      if (row.kind === 'folder') folderDbIds.push(row.meta.id);
      else itemRowIds.push(rowId);
    }

    // Breadcrumb drop → move all dragged rows into the clicked ancestor,
    // appended at its end. No precise-index semantics (user is saying
    // "move these OUT of here", not "into position K").
    if (overId && overId.startsWith(BREADCRUMB_PREFIX)) {
      const target =
        overId === BREADCRUMB_ROOT_ID
          ? null
          : overId.slice(BREADCRUMB_PREFIX.length);
      commitMoveToFolder({
        folderDbIds,
        itemRowIds,
        targetFolderId: target,
        insertion: null, // append
      });
      return;
    }

    // Row-level drop — use the insertion produced by computeInsertion.
    if (!snapshotInsertion) return;

    // CRITICAL: insertion.parentId is a ROW id (kind-prefixed, e.g.
    // "folder::abc123") because computeInsertion works on the flat row
    // list we built for DnD. The server / DB / FK constraint only
    // knows the bare cuid. If we ship the row id as parentId the
    // write fails with P2003 (foreign key violation against
    // ItemBankFolder_parentId_fkey / ContentItem_folderId_fkey).
    // Map it back to the DB id here, at the boundary between the DnD
    // layer and the persistence layer. If the insertion lands at the
    // current view's level (parentId=null) we fall back to the URL's
    // currentFolderId, which is already a DB id.
    const insParentRowId = snapshotInsertion.parentId;
    let targetFolderId;
    if (insParentRowId != null) {
      const targetRow = rowById.get(insParentRowId);
      targetFolderId = targetRow?.meta?.id ?? null;
      // Defensive: if we somehow can't resolve the row (shouldn't
      // happen for Bank where non-null parentId always points at a
      // visible folder row), bail rather than risk a P2003.
      if (targetFolderId == null) return;
    } else {
      targetFolderId = currentFolderId || null;
    }

    commitMoveToFolder({
      folderDbIds,
      itemRowIds,
      targetFolderId,
      insertion: snapshotInsertion,
    });
  }

  // ── Unified move commit ──
  //
  // ONE code path handles:
  //   * single-item reorder within a folder
  //   * single-folder reorder at root
  //   * cross-folder item move
  //   * cross-parent folder move
  //   * mixed multi-drag (folders + items together)
  //   * breadcrumb drop (append semantics)
  //
  // The dragged rows are split by kind (folders → api.folders.reorder,
  // items → api.bankItems.reorder) and dispatched atomically in
  // parallel. The server endpoints both set parent/folder + sortOrder
  // in one transaction, so from the DB's perspective it's still a
  // single logical move per kind — there's no intermediate inconsistent
  // state even if the two network calls resolve at different times.
  function commitMoveToFolder({
    folderDbIds,
    itemRowIds,
    targetFolderId,
    insertion, // null ⇒ append
  }) {
    // Cycle prevention for folders: can't move a folder into its own
    // subtree.
    const safeFolderIds = folderDbIds.filter(
      (id) => !dragFolderCreatesCycle(id, targetFolderId),
    );

    if (safeFolderIds.length > 0) {
      commitFoldersIntoTarget({
        folderDbIds: safeFolderIds,
        targetFolderId,
        insertion,
      });
    }
    if (itemRowIds.length > 0) {
      commitItemsIntoTarget({
        itemRowIds,
        targetFolderId,
        insertion,
      });
    }
  }

  function commitFoldersIntoTarget({ folderDbIds, targetFolderId, insertion }) {
    const siblings = localFolders
      .filter((f) => (f.parentId || null) === (targetFolderId || null))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const existing = siblings
      .map((f) => f.id)
      .filter((id) => !folderDbIds.includes(id));

    let insertIdx;
    if (!insertion) {
      insertIdx = existing.length;
    } else if (insertion.parentId != null) {
      // Drop INTO a folder → dropped folders become its first children.
      insertIdx = 0;
    } else {
      // Drop at current view level. The visible rows put folders
      // before items; `insertion.indexInParent` counts visible rows
      // that remain after the moved ones are removed. Find the
      // neighbouring folder at that index and map it to target-
      // sibling space.
      const visibleFolderIdsInView = rows
        .filter(
          (r) =>
            r.kind === 'folder' &&
            !folderDbIds.includes(r.meta.id),
        )
        .map((r) => r.meta.id);
      const neighbour = visibleFolderIdsInView[insertion.indexInParent];
      insertIdx =
        neighbour != null
          ? existing.indexOf(neighbour)
          : existing.length;
      if (insertIdx < 0) insertIdx = existing.length;
    }
    insertIdx = Math.max(0, Math.min(insertIdx, existing.length));
    const nextIds = [
      ...existing.slice(0, insertIdx),
      ...folderDbIds,
      ...existing.slice(insertIdx),
    ];

    console.log('[bank-dnd] commitFoldersIntoTarget', {
      folderDbIds,
      targetFolderId,
      existing,
      nextIds,
      insertIdx,
    });

    setLocalFolders((prev) =>
      prev.map((f) => {
        const idx = nextIds.indexOf(f.id);
        if (idx < 0) return f;
        return { ...f, parentId: targetFolderId || null, sortOrder: idx };
      }),
    );

    // Surface ALL errors, not just via onChanged. The bug where the
    // drop "flashes then reverts" was caused by the server returning
    // a non-2xx response — the old `.catch(() => onChanged())` call
    // silently triggered a refresh that overwrote the optimistic
    // update. We now log the exact error so any recurrence is
    // diagnosable from the browser console, and the refresh still
    // happens so the UI shows the real server state.
    console.log('[bank-dnd] → PUT /api/items/folders/reorder', {
      ids: nextIds,
      parentId: targetFolderId,
    });
    api.folders
      .reorder(nextIds, targetFolderId)
      .then((res) =>
        console.log('[bank-dnd] ← folders.reorder OK', { res }),
      )
      .catch((err) => {
        console.error('[bank-dnd] ✖ folders.reorder FAILED', {
          status: err?.status,
          message: err?.message,
          payload: err?.payload,
        });
        onChanged?.();
      });
  }

  function commitItemsIntoTarget({ itemRowIds, targetFolderId, insertion }) {
    const movedItems = rows
      .filter((r) => r.kind !== 'folder' && itemRowIds.includes(r.id))
      .map((r) => r.meta);
    if (movedItems.length === 0) return;

    const targetItems = [
      ...localContent
        .filter((i) => (i.folderId || null) === (targetFolderId || null))
        .map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
      ...localQuestions
        .filter((i) => (i.folderId || null) === (targetFolderId || null))
        .map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
    ].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // One formula for all cases:
    //   - insertion null (breadcrumb append) → end of target items
    //   - drop INTO a folder → first child (index 0)
    //   - drop at current view level → translate view-index to
    //     item-index by subtracting the folders that precede items in
    //     the visible rows. Math.max clamps to 0 when the drop landed
    //     in the folder section (dropping items-in-folder-area is
    //     meaningless; 0 is the natural top-of-items result).
    //
    // This is the same formula regardless of whether folders are also
    // being dragged. Mixed drag gets precise positioning because both
    // folder-side and item-side commits use their own independent
    // index calculation.
    let insertIdx;
    if (!insertion) {
      insertIdx = targetItems.length;
    } else if (insertion.parentId != null) {
      insertIdx = 0;
    } else {
      const visibleFolderCount = rows.filter(
        (r) => r.kind === 'folder',
      ).length;
      insertIdx = Math.max(
        0,
        insertion.indexInParent - visibleFolderCount,
      );
    }

    const finalList = buildTargetOrder({
      targetChildren: targetItems,
      insertionIndex: insertIdx,
      movedRows: movedItems.map((m) => ({ id: m.id, kind: m.kind })),
    });

    const patches = new Map();
    finalList.forEach((row, idx) => {
      patches.set(`${row.kind}:${row.id}`, {
        sortOrder: idx,
        folderId: targetFolderId,
      });
    });

    // Plain setState — batches with the drag-state clear into one
    // render after onDragEnd returns.
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

    const payload = finalList.map((r) => ({ kind: r.kind, id: r.id }));
    console.log('[bank-dnd] → PUT /api/items/reorder', {
      ordered: payload,
      folderId: targetFolderId,
    });
    api.bankItems
      .reorder(payload, targetFolderId)
      .then((res) =>
        console.log('[bank-dnd] ← bankItems.reorder OK', { res }),
      )
      .catch((err) => {
        console.error('[bank-dnd] ✖ bankItems.reorder FAILED', {
          status: err?.status,
          message: err?.message,
          payload: err?.payload,
        });
        onChanged?.();
      });
  }

  function dragFolderCreatesCycle(folderId, targetParentId) {
    if (!targetParentId) return false;
    if (targetParentId === folderId) return true;
    return folderDescendantIds(folderId).has(targetParentId);
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
      // Preserve the folder URL param on the editor URL so the list
      // pane stays in this folder while the editor opens (and so the
      // editor can navigate back to the same folder on delete).
      const qs = folderId ? `?folder=${encodeURIComponent(folderId)}` : '';
      if (kind === ITEM_KINDS.CONTENT) {
        const created = await api.contentItems.create({
          title: '',
          body: '',
          folderId,
        });
        onChanged?.();
        navigate(`/admin/procedures/bank/content/${created.id}${qs}`);
      } else {
        // Default new-question shape: free-text enabled, optional.
        // Admin opens the editor and narrows the shape (add options /
        // change requirement) before saving.
        const created = await api.questionItems.create({
          title: '',
          questionText: '',
          options: [],
          allowTextAnswer: true,
          requirement: 'optional',
          folderId,
        });
        onChanged?.();
        navigate(`/admin/procedures/bank/question/${created.id}${qs}`);
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
                dropIntoFolderId={
                  insertion && insertion.parentId
                    ? insertion.parentId
                    : null
                }
                selectedIds={sel.selected}
                selectedFlowRoute={selectedId}
                onEnterFolder={onEnterFolder}
                onOpen={(row) => {
                  // Preserve the folder URL so the list keeps showing
                  // the folder the user was in when they opened the
                  // editor. Without this, the list pane snaps to root
                  // while the editor opens.
                  const qs = currentFolderId
                    ? `?folder=${encodeURIComponent(currentFolderId)}`
                    : '';
                  navigate(
                    `/admin/procedures/bank/${row.kind}/${row.id}${qs}`,
                  );
                }}
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
        isSelected={isSelected}
        isDropTarget={isDropTarget}
        onEnterFolder={onEnterFolder}
        onSelectClick={onSelectClick}
        onToggleSelect={onToggleSelect}
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
// Folders are first-class selectable just like items. Plain click
// enters the folder; modifier clicks (Ctrl/Cmd/Shift) route to the
// selection system; the checkbox is the explicit multi-select path for
// touch + no-modifier users. Mixed selections (folders + items) are
// supported — the drag set carries whatever is selected.
function FolderRow({
  row,
  isActive,
  isDragSource,
  isSelected,
  isDropTarget,
  onEnterFolder,
  onSelectClick,
  onToggleSelect,
  onRenameFolder,
  onDeleteFolder,
}) {
  const { meta } = row;
  const drag = useDraggable({ id: row.id, data: { kind: 'folder' } });
  const drop = useDroppable({ id: row.id, data: { kind: 'folder' } });
  const setRef = useCallback(
    (el) => {
      drag.setNodeRef(el);
      drop.setNodeRef(el);
    },
    [drag.setNodeRef, drop.setNodeRef],
  );

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
    onEnterFolder(meta.id);
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
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition ${
          isDropTarget
            ? 'bg-blue-100 ring-2 ring-inset ring-blue-500'
            : isSelected
            ? 'bg-blue-50/60'
            : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onCheckboxChange}
          onClick={onCheckboxClick}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 cursor-pointer"
          aria-label="סימון תיקייה לפעולה מרובה"
        />
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
