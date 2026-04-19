import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import {
  ITEM_KINDS,
  ITEM_KIND_LABELS,
  LIST_FILTERS,
} from '../bank/config.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import InlineItemEditor from './InlineItemEditor.jsx';

// Modal picker for the flow editor. Multi-pick: each click adds the item
// and keeps the picker open. In addition to picking existing items, the
// admin can:
//   - create a brand-new content/question item here (side-panel editor,
//     not a cramped modal)
//   - import an entire bank folder as a flow group (folder → group
//     materialization; it's a one-shot copy, not a live link).
export default function ItemPicker({ open, onClose, onPick, onPickFolder }) {
  const [content, setContent] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [addedCount, setAddedCount] = useState(0);
  const [flashId, setFlashId] = useState(null);
  const [view, setView] = useState('items'); // 'items' | 'folders'
  const flashTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setFilter('all');
    setAddedCount(0);
    setFlashId(null);
    setView('items');
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [c, q, f] = await Promise.all([
          api.contentItems.list(),
          api.questionItems.list(),
          api.folders.list().catch(() => []),
        ]);
        if (!cancelled) {
          setContent(c);
          setQuestions(q);
          setFolders(f);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const combined = useMemo(() => {
    const all = [
      ...content.map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
      ...questions.map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
    ];
    all.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        new Date(a.createdAt) - new Date(b.createdAt),
    );
    return all;
  }, [content, questions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return combined.filter((i) => {
      if (filter !== 'all' && i.kind !== filter) return false;
      if (q && !titleToPlain(i.title).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [combined, search, filter]);

  // Side-panel inline editor state.
  const [createKind, setCreateKind] = useState(null);

  function pick(item) {
    onPick(item.kind, item.id, item);
    setAddedCount((n) => n + 1);
    setFlashId(`${item.kind}:${item.id}`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 900);
  }

  async function handleCreated(created, kind) {
    if (kind === ITEM_KINDS.CONTENT) setContent((prev) => [...prev, created]);
    else setQuestions((prev) => [...prev, created]);
    pick({ ...created, kind });
    setCreateKind(null);
  }

  function folderItems(folderId) {
    return combined
      .filter((i) => (i.folderId || null) === folderId)
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          new Date(a.createdAt) - new Date(b.createdAt),
      );
  }

  function pickFolder(folder) {
    const items = folderItems(folder.id);
    if (items.length === 0) return;
    onPickFolder?.(folder, items);
    setAddedCount((n) => n + 1);
    setFlashId(`folder:${folder.id}`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 900);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="בחירת פריט"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="rtl"
        className="bg-white w-full sm:max-w-xl sm:rounded-lg shadow-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh', minHeight: '60vh' }}
      >
        <div className="p-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
          <div className="flex-1 font-semibold text-gray-900">בחירת פריט</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="text-gray-500 hover:bg-gray-100 rounded px-2 py-1"
          >
            ×
          </button>
        </div>
        <div className="p-3 space-y-2 border-b border-gray-200 shrink-0">
          {/* View toggle: items vs folder-as-group. */}
          <div className="flex gap-1 bg-gray-100 rounded-md p-1">
            <button
              onClick={() => setView('items')}
              className={`flex-1 text-center px-2 py-1 text-[12px] rounded ${
                view === 'items'
                  ? 'bg-white shadow-sm text-gray-900 font-semibold'
                  : 'text-gray-600'
              }`}
            >
              פריטים בודדים
            </button>
            <button
              onClick={() => setView('folders')}
              className={`flex-1 text-center px-2 py-1 text-[12px] rounded ${
                view === 'folders'
                  ? 'bg-white shadow-sm text-gray-900 font-semibold'
                  : 'text-gray-600'
              }`}
            >
              תיקייה כקבוצה
            </button>
          </div>

          {view === 'items' && (
            <>
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש פריט..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreateKind(ITEM_KINDS.CONTENT)}
                  className="flex-1 text-[12px] border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-2 py-1.5"
                >
                  + צור תוכן חדש כאן
                </button>
                <button
                  type="button"
                  onClick={() => setCreateKind(ITEM_KINDS.QUESTION)}
                  className="flex-1 text-[12px] border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md px-2 py-1.5"
                >
                  + צור שאלה חדשה כאן
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
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
          )}
          {error && !loading && (
            <div className="p-6 text-center text-sm text-red-600">
              שגיאה: {error}
            </div>
          )}

          {!loading && !error && view === 'items' && (
            <>
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">
                  {combined.length === 0
                    ? 'אין פריטים בבנק. צרו פריט חדש.'
                    : 'לא נמצאו פריטים תואמים.'}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {filtered.map((item) => {
                    const rowKey = `${item.kind}:${item.id}`;
                    const justAdded = flashId === rowKey;
                    return (
                      <li key={rowKey}>
                        <button
                          onClick={() => pick(item)}
                          className={`w-full text-right px-3 py-3 transition block ${
                            justAdded ? 'bg-green-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                item.kind === ITEM_KINDS.QUESTION
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {ITEM_KIND_LABELS[item.kind]}
                            </span>
                            <PickerTitle title={item.title} />
                            {justAdded && (
                              <span className="text-[11px] text-green-700 font-medium shrink-0">
                                ✓ נוסף
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {relativeHebrew(item.updatedAt)}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {!loading && !error && view === 'folders' && (
            <FolderList
              folders={folders}
              folderItems={folderItems}
              flashId={flashId}
              onPick={pickFolder}
            />
          )}
        </div>
        <div className="p-3 border-t border-gray-200 flex items-center gap-2 shrink-0">
          <div className="flex-1 text-[13px] text-gray-600">
            {addedCount === 0
              ? view === 'folders'
                ? 'בחרו תיקייה כדי להוסיף את הפריטים שבה כקבוצה חדשה'
                : 'לחצו על פריט כדי להוסיף לזרימה'
              : addedCount === 1
              ? 'נוסף פריט אחד בהפעלה הנוכחית'
              : `נוספו ${addedCount} פריטים בהפעלה הנוכחית`}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-1.5 font-medium"
          >
            סיים
          </button>
        </div>
      </div>

      {createKind && (
        <InlineItemEditor
          kind={createKind}
          onClose={() => setCreateKind(null)}
          onFinalize={(created) => handleCreated(created, createKind)}
        />
      )}
    </div>
  );
}

function FolderList({ folders, folderItems, flashId, onPick }) {
  if (folders.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        אין תיקיות בבנק. תיקיות נוצרות בלשונית "בנק פריטים".
      </div>
    );
  }
  return (
    <ul className="divide-y divide-gray-100">
      {folders.map((f) => {
        const items = folderItems(f.id);
        const just = flashId === `folder:${f.id}`;
        const count = items.length;
        return (
          <li key={f.id}>
            <button
              onClick={() => onPick(f)}
              disabled={count === 0}
              className={`w-full text-right px-3 py-3 transition block disabled:opacity-50 ${
                just ? 'bg-green-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                  תיקייה
                </span>
                <span className="font-medium text-gray-900 truncate flex-1">
                  {f.name}
                </span>
                {just && (
                  <span className="text-[11px] text-green-700 font-medium shrink-0">
                    ✓ נוסף כקבוצה
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-500">
                {count} פריטים {count === 0 ? '(ריקה)' : ''}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PickerTitle({ title }) {
  const isHtml = typeof title === 'string' && /<[a-z]/i.test(title);
  if (isHtml) {
    return (
      <span
        className="gos-prose font-medium text-gray-900 truncate flex-1"
        dir="rtl"
        dangerouslySetInnerHTML={{ __html: title }}
      />
    );
  }
  return (
    <span className="font-medium text-gray-900 truncate flex-1">
      {titleToPlain(title) || '(ללא כותרת)'}
    </span>
  );
}
