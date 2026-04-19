import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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
  const inEditor =
    pathname !== '/admin/procedures/bank' &&
    pathname !== '/admin/procedures/bank/';

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
        <Outlet context={{ refresh }} />
      </section>
    </div>
  );
}
