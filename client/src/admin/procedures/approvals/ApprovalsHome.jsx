import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import ResizeHandle from '../../../shell/ResizeHandle.jsx';
import ApprovalsListPane from './ApprovalsListPane.jsx';

const STORAGE_KEY = 'gos.procedures.listPaneWidth';
const VIEW_STORAGE_KEY = 'gos.approvals.view';
const STATUS_STORAGE_KEY = 'gos.approvals.status';
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

// Approvals tab layout. Mirrors FlowsHome and BankHome: list on the
// leading edge, detail on the main edge, mobile toggles based on whether
// a detail is open.
export default function ApprovalsHome() {
  const { pathname } = useLocation();
  const inDetail =
    pathname !== '/admin/procedures/approvals' &&
    pathname !== '/admin/procedures/approvals/';

  const [listWidth, setListWidth] = useState(readStoredWidth);
  const [viewKey, setViewKey] = useState(
    () => localStorage.getItem(VIEW_STORAGE_KEY) || 'inbox',
  );
  const [statusFilter, setStatusFilter] = useState(
    () => localStorage.getItem(STATUS_STORAGE_KEY) ?? 'submitted',
  );
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const persistWidth = useCallback((w) => {
    setListWidth(w);
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

  const onViewChange = useCallback((v) => {
    setViewKey(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const onStatusFilterChange = useCallback((s) => {
    setStatusFilter(s);
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  // Two refresh modes:
  //   * loadFiltered — toggles `loading=true` so the side pane shows
  //     "טוען…". Used on first mount and on filter change, where the
  //     dataset is genuinely changing and a brief loading state is
  //     accurate.
  //   * softRefresh  — no loading flag. Used by polling and by post-
  //     approve/reject refresh from the detail pane. Avoids tearing
  //     the page down to "טוען…" + scroll-to-top after every action.
  const loadFiltered = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.reviews.list(
        statusFilter ? { status: statusFilter } : {},
      );
      setAttempts(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const softRefresh = useCallback(async () => {
    try {
      const list = await api.reviews.list(
        statusFilter ? { status: statusFilter } : {},
      );
      setAttempts(list);
      setError(null);
    } catch (e) {
      // Silent failure on background refreshes — the existing list
      // is still on screen, and the next attempt may succeed. Surface
      // the error only if the polling loop keeps failing (caller can
      // add retry-counter UX later).
      console.warn('[approvals soft refresh] failed', e);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadFiltered();
  }, [loadFiltered]);

  // Light polling so admins see new submissions without manual
  // refresh. Soft so it doesn't flash "טוען…" every 15s.
  useEffect(() => {
    const t = setInterval(softRefresh, 15000);
    return () => clearInterval(t);
  }, [softRefresh]);

  const listCls = inDetail
    ? 'hidden lg:flex w-full lg:w-[var(--list-width)] lg:shrink-0 bg-white flex-col min-h-0'
    : 'flex w-full lg:w-[var(--list-width)] lg:shrink-0 bg-white flex-col min-h-0';

  const workCls = inDetail
    ? 'flex flex-1 bg-gray-50 min-h-0'
    : 'hidden lg:flex flex-1 bg-gray-50 min-h-0';

  return (
    <div
      className="h-full flex"
      style={{ '--list-width': `${listWidth}px` }}
    >
      <aside className={listCls}>
        <ApprovalsListPane
          attempts={attempts}
          loading={loading}
          error={error}
          onRetry={loadFiltered}
          viewKey={viewKey}
          onViewChange={onViewChange}
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
        />
      </aside>
      <ResizeHandle
        currentWidth={listWidth}
        onResize={persistWidth}
        minWidth={MIN_LIST_WIDTH}
        maxWidth={MAX_LIST_WIDTH}
        ariaLabel="שינוי רוחב רשימת האישורים"
      />
      <section className={workCls}>
        {/* Outlet receives the SOFT refresh — post-approve/reject
            should never collapse the list to "טוען…" or reset its
            scroll. The only "loud" load comes from filter change
            (above), where the data genuinely needs a moment. */}
        <Outlet context={{ refresh: softRefresh }} />
      </section>
    </div>
  );
}
