import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import ResizeHandle from '../../../shell/ResizeHandle.jsx';
import FlowsListPane from './FlowsListPane.jsx';

// Shared storage key with bank — both tabs use the same user-chosen width.
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

// Flows tab layout: flows list on the leading edge (right in RTL), flow
// editor or empty-state on the main edge (left in RTL). Mobile toggles
// based on whether a flow is open.
export default function FlowsHome() {
  const { pathname } = useLocation();
  const inEditor =
    pathname !== '/admin/procedures/flows' &&
    pathname !== '/admin/procedures/flows/';

  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [listWidth, setListWidth] = useState(readStoredWidth);

  const persistWidth = useCallback((w) => {
    setListWidth(w);
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.flows.list();
      setFlows(list);
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
        <FlowsListPane
          flows={flows}
          loading={loading}
          error={error}
          onRetry={refresh}
          onCreated={refresh}
        />
      </aside>
      <ResizeHandle
        currentWidth={listWidth}
        onResize={persistWidth}
        minWidth={MIN_LIST_WIDTH}
        maxWidth={MAX_LIST_WIDTH}
        ariaLabel="שינוי רוחב רשימת הזרימות"
      />
      <section className={workCls}>
        <Outlet context={{ refresh }} />
      </section>
    </div>
  );
}
