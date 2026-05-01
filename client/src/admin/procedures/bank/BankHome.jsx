import { useCallback, useEffect, useState } from 'react';
import {
  Outlet,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { api } from '../../../lib/api.js';
import ResizeHandle from '../../../shell/ResizeHandle.jsx';
import BankListPane from './BankListPane.jsx';

// Persistence of the user's chosen list-pane width. Desktop-only behavior;
// mobile always uses full width.
const STORAGE_KEY = 'gos.procedures.listPaneWidth';
const DEFAULT_LIST_WIDTH = 360;
const MIN_LIST_WIDTH = 240;
const MAX_LIST_WIDTH = 640;

function readStoredWidth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LIST_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_LIST_WIDTH;
    return Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, n));
  } catch {
    return DEFAULT_LIST_WIDTH;
  }
}

// Bank tab layout: list pane on the leading edge (right in RTL), work area
// on the main edge (left in RTL). On mobile, only one of them is shown at
// a time — the list at the index route, the editor at nested routes.
export default function BankHome() {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const inEditor =
    pathname !== '/admin/procedures/bank' &&
    pathname !== '/admin/procedures/bank/';

  // Drill-down navigation: the `folder` query param identifies the
  // currently-entered folder. null/missing = root. Browser back/forward
  // works because we push history via setSearchParams.
  const currentFolderId = searchParams.get('folder') || null;
  const setCurrentFolderId = useCallback(
    (id) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('folder', id);
          else next.delete('folder');
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const [content, setContent] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [listWidth, setListWidth] = useState(readStoredWidth);

  const persistWidth = useCallback((w) => {
    setListWidth(w);
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [c, q, f] = await Promise.all([
        api.contentItems.list(),
        api.questionItems.list(),
        api.folders.list().catch(() => []),
      ]);
      setContent(c);
      setQuestions(q);
      setFolders(f);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Surgical, single-item update used by editors right after autosave.
  // This is the bank-list's "live" path: no HTTP refetch, no full state
  // swap — just merge the patch into the matching row in place. Sidebar
  // re-renders the one affected card; scroll position, drag state, and
  // sortable registrations all stay intact because ids and sortOrders
  // don't change. If we called refresh() instead, the whole list would
  // refetch and the click-jump bug we fixed earlier would return.
  const patchItem = useCallback((kind, id, patch) => {
    if (!id || !patch) return;
    const merger = (prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patch } : i));
    if (kind === 'content') setContent(merger);
    else if (kind === 'question') setQuestions(merger);
  }, []);

  // ── Surgical add / remove / folder-patch ────────────────────────
  // Every "thing changed" path used to call refresh() (a full triple-
  // refetch of content + questions + folders). On a bank with hundreds
  // of items that's the chunk of latency the user feels when they
  // create / rename / delete. The helpers below mutate localStorage-
  // free state in place; the server still sees the truth, but the UI
  // doesn't re-flow the whole sidebar.
  //
  // They share one rule: the data added/removed is whatever the
  // caller already has in hand from the API response, so no extra
  // round trip is needed.
  const addContent = useCallback((item) => {
    if (!item?.id) return;
    setContent((prev) =>
      prev.some((i) => i.id === item.id) ? prev : [...prev, item],
    );
  }, []);
  const addQuestion = useCallback((item) => {
    if (!item?.id) return;
    setQuestions((prev) =>
      prev.some((i) => i.id === item.id) ? prev : [...prev, item],
    );
  }, []);
  const addFolder = useCallback((folder) => {
    if (!folder?.id) return;
    setFolders((prev) =>
      prev.some((f) => f.id === folder.id) ? prev : [...prev, folder],
    );
  }, []);
  const patchFolder = useCallback((id, patch) => {
    if (!id || !patch) return;
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  }, []);

  // Removing a row is a bit more than a filter for folders: the schema
  // uses ON DELETE SET NULL on both ItemBankFolder.parent and
  // ContentItem.folder / QuestionItem.folder, so deleting one folder
  // re-parents its DIRECT children (folders + items) to root. We mirror
  // that here so the optimistic state matches what the server just did.
  const removeMany = useCallback(
    ({ contentIds = [], questionIds = [], folderIds = [] } = {}) => {
      const cSet = new Set(contentIds);
      const qSet = new Set(questionIds);
      const fSet = new Set(folderIds);
      if (cSet.size === 0 && qSet.size === 0 && fSet.size === 0) return;
      if (cSet.size > 0) {
        setContent((prev) => prev.filter((i) => !cSet.has(i.id)));
      }
      if (qSet.size > 0) {
        setQuestions((prev) => prev.filter((i) => !qSet.has(i.id)));
      }
      if (fSet.size > 0) {
        // 1. Drop the deleted folders themselves.
        setFolders((prev) =>
          prev
            .filter((f) => !fSet.has(f.id))
            // 2. Float ANY folder whose parent was deleted up to root.
            .map((f) =>
              f.parentId && fSet.has(f.parentId)
                ? { ...f, parentId: null }
                : f,
            ),
        );
        // 3. Re-home items whose folder was deleted.
        setContent((prev) =>
          prev.map((i) =>
            i.folderId && fSet.has(i.folderId) ? { ...i, folderId: null } : i,
          ),
        );
        setQuestions((prev) =>
          prev.map((i) =>
            i.folderId && fSet.has(i.folderId) ? { ...i, folderId: null } : i,
          ),
        );
      }
    },
    [],
  );
  const removeContent = useCallback(
    (id) => removeMany({ contentIds: [id] }),
    [removeMany],
  );
  const removeQuestion = useCallback(
    (id) => removeMany({ questionIds: [id] }),
    [removeMany],
  );

  const listCls = inEditor
    ? 'hidden lg:flex w-full lg:w-[var(--list-width)] lg:shrink-0 bg-white flex-col min-h-0'
    : 'flex w-full lg:w-[var(--list-width)] lg:shrink-0 bg-white flex-col min-h-0';

  const workCls = inEditor
    ? 'flex flex-1 bg-gray-50 min-h-0'
    : 'hidden lg:flex flex-1 bg-gray-50 min-h-0';

  return (
    <div
      className="h-full flex"
      style={{ '--list-width': `${listWidth}px` }}
    >
      <aside className={listCls}>
        <BankListPane
          content={content}
          questions={questions}
          folders={folders}
          loading={loading}
          error={error}
          onRetry={refresh}
          onChanged={refresh}
          currentFolderId={currentFolderId}
          onEnterFolder={setCurrentFolderId}
          addContent={addContent}
          addQuestion={addQuestion}
          addFolder={addFolder}
          patchFolder={patchFolder}
          removeMany={removeMany}
        />
      </aside>
      <ResizeHandle
        currentWidth={listWidth}
        onResize={persistWidth}
        minWidth={MIN_LIST_WIDTH}
        maxWidth={MAX_LIST_WIDTH}
        ariaLabel="שינוי רוחב רשימת הפריטים"
      />
      <section className={workCls}>
        <Outlet
          context={{
            refresh,
            patchItem,
            // Surgical removers used by editor delete flow — eliminates the
            // refetch-then-navigate pattern.
            removeContent,
            removeQuestion,
          }}
        />
      </section>
    </div>
  );
}
