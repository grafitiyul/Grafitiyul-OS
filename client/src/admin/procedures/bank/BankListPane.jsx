import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ITEM_KINDS, ITEM_KIND_LABELS, LIST_FILTERS, ANSWER_TYPES } from './config.js';
import { api } from '../../../lib/api.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import PromptDialog from '../../common/PromptDialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';

const COLLAPSE_STORAGE_KEY = 'gos.bank.folderCollapsed';

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

// Mixed content + question items are ordered by a single shared sortOrder
// so the user's chosen drag order is preserved exactly — no alternating by
// kind.
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

  // Scroll preservation. The list re-renders every time the user edits an
  // item (autosave → refresh → props change). Without this, browsers
  // sometimes reset scrollTop to 0 when React reconciles the new tree, or
  // when the sortable registrations swap. We track scrollTop in a ref on
  // every scroll event and restore it synchronously after every commit.
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

  // Optimistic local copies for snappy drag feedback.
  const [localContent, setLocalContent] = useState(content);
  const [localQuestions, setLocalQuestions] = useState(questions);
  const [localFolders, setLocalFolders] = useState(folders);
  useEffect(() => setLocalContent(content), [content]);
  useEffect(() => setLocalQuestions(questions), [questions]);
  useEffect(() => setLocalFolders(folders), [folders]);

  function toggleFolder(id) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeCollapsed(next);
      return next;
    });
  }

  const groups = useMemo(
    () => buildGroupedView(localContent, localQuestions, localFolders, search, filter),
    [localContent, localQuestions, localFolders, search, filter],
  );

  const totalCount = localContent.length + localQuestions.length;
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  // ── Drag handlers ──

  async function onDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = parseDragId(active.id);
    const o = parseDragId(over.id);

    // Folder ⇄ folder: reorder folders.
    if (a.kind === 'folder' && o.kind === 'folder') {
      const ids = localFolders.map((f) => f.id);
      const from = ids.indexOf(a.id);
      const to = ids.indexOf(o.id);
      if (from < 0 || to < 0) return;
      const next = arrayMove(ids, from, to);
      setLocalFolders(next.map((id) => localFolders.find((f) => f.id === id)));
      try {
        await api.folders.reorder(next);
      } finally {
        onChanged?.();
      }
      return;
    }

    // Item dropped onto a folder header → move to that folder (appended).
    if (a.kind !== 'folder' && o.kind === 'folder') {
      const targetFolderId = o.id === '__ungrouped__' ? null : o.id;
      await moveItem(a, targetFolderId);
      return;
    }

    // Item ⇄ item: reorder within the (possibly new) folder, respecting
    // mixed-kind order — no forced alternation.
    if (a.kind !== 'folder' && o.kind !== 'folder') {
      const aItem = findItem(a);
      const oItem = findItem(o);
      if (!aItem || !oItem) return;
      const targetFolderId = oItem.folderId || null;
      const sameFolder = (aItem.folderId || null) === targetFolderId;
      if (!sameFolder) {
        // Cross-folder: set folderId + append, then reindex.
        await moveItem(a, targetFolderId);
        return;
      }
      // Same folder: compute combined ordered list and reindex across kinds.
      // Tag kind explicitly by source array (not by field shape) so we never
      // misclassify an item.
      const folderItems = [
        ...localContent
          .filter((i) => (i.folderId || null) === targetFolderId)
          .map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
        ...localQuestions
          .filter((i) => (i.folderId || null) === targetFolderId)
          .map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
      ].sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));
      const from = folderItems.findIndex(
        (i) => i.id === aItem.id && i.kind === aItem.kind,
      );
      const to = folderItems.findIndex(
        (i) => i.id === oItem.id && i.kind === oItem.kind,
      );
      if (from < 0 || to < 0) return;
      const reordered = arrayMove(folderItems, from, to).map((i, idx) => ({
        ...i,
        sortOrder: idx,
      }));
      // Apply optimistically.
      setLocalContent((prev) =>
        prev.map((i) => {
          const m = reordered.find(
            (r) => r.id === i.id && r.kind === ITEM_KINDS.CONTENT,
          );
          return m ? { ...i, sortOrder: m.sortOrder } : i;
        }),
      );
      setLocalQuestions((prev) =>
        prev.map((i) => {
          const m = reordered.find(
            (r) => r.id === i.id && r.kind === ITEM_KINDS.QUESTION,
          );
          return m ? { ...i, sortOrder: m.sortOrder } : i;
        }),
      );
      try {
        await api.bankItems.reorder(
          reordered.map((i) => ({ kind: i.kind, id: i.id })),
          targetFolderId,
        );
      } finally {
        onChanged?.();
      }
    }
  }

  function findItem({ kind, id }) {
    if (kind === ITEM_KINDS.CONTENT) return localContent.find((i) => i.id === id);
    if (kind === ITEM_KINDS.QUESTION) return localQuestions.find((i) => i.id === id);
    return null;
  }

  async function moveItem({ kind, id }, targetFolderId) {
    const setter = kind === ITEM_KINDS.CONTENT ? setLocalContent : setLocalQuestions;
    setter((prev) =>
      prev.map((i) => (i.id === id ? { ...i, folderId: targetFolderId } : i)),
    );
    try {
      if (kind === ITEM_KINDS.CONTENT) await api.contentItems.move(id, targetFolderId);
      else await api.questionItems.move(id, targetFolderId);
    } finally {
      onChanged?.();
    }
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

  // ── Preview ──
  function openPreview(item) {
    const url = `/preview/${item.kind}/${item.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ── "+ new" pre-creates on server, then navigates to its autosave editor.
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
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        {loading && <div className="p-6 text-center text-sm text-gray-500">טוען…</div>}
        {error && !loading && (
          <div className="p-6 text-center">
            <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
            <div className="text-xs text-gray-500 mb-3 font-mono" dir="ltr">{error}</div>
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
        {!loading && !error && totalCount > 0 && visibleCount === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">
            לא נמצאו פריטים תואמים.
          </div>
        )}
        {!loading && !error && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={[
                ...localFolders.map((f) => makeDragId('folder', f.id)),
                makeDragId('folder', '__ungrouped__'),
              ]}
              strategy={verticalListSortingStrategy}
            >
              {groups.map((g) => (
                <FolderSection
                  key={g.id}
                  group={g}
                  collapsed={!!collapsed[g.id]}
                  onToggle={() => toggleFolder(g.id)}
                  selectedId={selectedId}
                  onOpen={(item) =>
                    navigate(`/admin/procedures/bank/${item.kind}/${item.id}`)
                  }
                  onPreview={openPreview}
                  onRenameFolder={(f) => setRenameFolder(f)}
                  onDeleteFolder={(f) => setDeleteFolder(f)}
                  folders={localFolders}
                  onMoveItem={moveItem}
                />
              ))}
            </SortableContext>
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

// ── Helpers ──

function buildGroupedView(content, questions, folders, search, filter) {
  const byFolder = new Map();
  byFolder.set('__ungrouped__', {
    id: '__ungrouped__',
    name: 'ללא תיקייה',
    items: [],
    isUngrouped: true,
  });
  for (const f of folders) {
    byFolder.set(f.id, { ...f, items: [], isUngrouped: false });
  }
  const push = (i, kind) => {
    const key = i.folderId || '__ungrouped__';
    const bucket = byFolder.get(key) || byFolder.get('__ungrouped__');
    bucket.items.push({ ...i, kind });
  };
  for (const i of content) push(i, ITEM_KINDS.CONTENT);
  for (const i of questions) push(i, ITEM_KINDS.QUESTION);

  const q = search.trim().toLowerCase();
  const matches = (item) => {
    if (filter !== 'all' && item.kind !== filter) return false;
    if (!q) return true;
    return titleToPlain(item.title).toLowerCase().includes(q);
  };

  // Sort by the globally-unique sortOrder only. No tie-breaker — the
  // server guarantees unique sortOrder per folder across both kinds after
  // the reindex migration, so ties would only appear if the data is
  // inconsistent. Any tie-breaker here would re-introduce the "alternating
  // by kind" behavior the user explicitly rejected.
  const ordered = [];
  const byOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  for (const f of folders) {
    const bucket = byFolder.get(f.id);
    bucket.items.sort(byOrder);
    ordered.push({ ...bucket, items: bucket.items.filter(matches) });
  }
  const ung = byFolder.get('__ungrouped__');
  ung.items.sort(byOrder);
  ordered.push({ ...ung, items: ung.items.filter(matches) });
  return ordered;
}

function makeDragId(kind, id) {
  return `${kind}::${id}`;
}
function parseDragId(dragId) {
  const idx = String(dragId).indexOf('::');
  if (idx < 0) return { kind: null, id: String(dragId) };
  return { kind: dragId.slice(0, idx), id: dragId.slice(idx + 2) };
}

// ── Folder section ──

function FolderSection({
  group,
  collapsed,
  onToggle,
  selectedId,
  onOpen,
  onPreview,
  onRenameFolder,
  onDeleteFolder,
  folders,
  onMoveItem,
}) {
  const dragId = makeDragId('folder', group.id);
  const sortable = useSortable({ id: dragId, disabled: group.isUngrouped });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div ref={sortable.setNodeRef} style={style} className="border-b border-gray-100">
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-gray-50 ${
          sortable.isDragging ? 'opacity-50' : ''
        }`}
      >
        {!group.isUngrouped && (
          <button
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label="גרור תיקייה"
            className="text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing text-xs font-mono px-1"
            style={{ touchAction: 'none' }}
          >
            ⋮⋮
          </button>
        )}
        <button
          onClick={onToggle}
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
          <span className="truncate">{group.name}</span>
          <span className="text-[11px] text-gray-500 font-normal">
            ({group.items.length})
          </span>
        </button>
        {!group.isUngrouped && (
          <>
            <button
              onClick={() => onRenameFolder(group)}
              className="text-[11px] text-gray-500 hover:bg-gray-200 rounded px-2 py-0.5"
              title="שנה שם"
            >
              ✎
            </button>
            <button
              onClick={() => onDeleteFolder(group)}
              className="text-[11px] text-red-600 hover:bg-red-50 rounded px-2 py-0.5"
              title="מחק תיקייה"
            >
              ×
            </button>
          </>
        )}
      </div>
      {!collapsed && (
        <SortableContext
          items={group.items.map((i) => makeDragId(i.kind, i.id))}
          strategy={verticalListSortingStrategy}
        >
          <ul className="divide-y divide-gray-100">
            {group.items.map((item) => (
              <ItemRow
                key={`${item.kind}:${item.id}`}
                item={item}
                selectedId={selectedId}
                onOpen={onOpen}
                onPreview={onPreview}
                folders={folders}
                onMove={onMoveItem}
              />
            ))}
            {group.items.length === 0 && (
              <li className="px-3 py-3 text-[12px] text-gray-500 italic">ריקה</li>
            )}
          </ul>
        </SortableContext>
      )}
    </div>
  );
}

function ItemRow({ item, selectedId, onOpen, onPreview, folders, onMove }) {
  const dragId = makeDragId(item.kind, item.id);
  const sortable = useSortable({ id: dragId });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  };

  return (
    <li ref={sortable.setNodeRef} style={style}>
      <div
        className={`group flex items-center gap-1 px-2 py-2 hover:bg-gray-50 transition ${
          selectedId === item.id ? 'bg-blue-50' : ''
        }`}
      >
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label="גרור"
          className="shrink-0 w-5 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <span className="font-mono text-[11px] leading-none">⋮⋮</span>
        </button>
        <button
          onClick={() => onOpen(item)}
          className="flex-1 min-w-0 text-right flex items-center gap-2 py-1"
        >
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
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreview(item);
          }}
          className="shrink-0 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded p-1"
          title="תצוגה מקדימה"
          aria-label="תצוגה מקדימה"
        >
          <EyeIcon />
        </button>
        <FolderMenu item={item} folders={folders} onMove={onMove} />
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

function FolderMenu({ item, folders, onMove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (folders.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="shrink-0 text-gray-500 hover:bg-gray-100 rounded p-1"
        title="העבר לתיקייה"
        aria-label="העבר לתיקייה"
      >
        <span className="text-[13px]">⋯</span>
      </button>
      {open && (
        <div className="absolute z-20 end-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]">
          <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wide">
            העבר לתיקייה
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onMove(item, null);
            }}
            className="w-full text-right px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            ללא תיקייה
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setOpen(false);
                onMove(item, f.id);
              }}
              className="w-full text-right px-3 py-1.5 text-sm hover:bg-gray-50 truncate"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
