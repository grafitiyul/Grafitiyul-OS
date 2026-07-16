import { Outlet, Link, useLocation } from 'react-router-dom';
import { CRM_TABS } from './config.js';

// Top-level layout for the CRM module. Mirrors PeopleLayout / ProceduresLayout
// so the shell, desktop tabs, and mobile tab bar stay consistent.
export default function CrmLayout() {
  const { pathname } = useLocation();
  // Derived FROM CRM_TABS rather than a parallel if/else chain, so adding a tab
  // is a one-line edit in config.js. Longest path first, so a nested route can
  // never be shadowed by a shorter sibling. Deals stays the fallback because a
  // deal URL is `/admin/crm/deals<orderNo>` with no separator (see dealPath).
  const activeKey =
    [...CRM_TABS]
      .sort((a, b) => b.path.length - a.path.length)
      .find((t) => pathname.startsWith(`/admin/crm/${t.path}`))?.key || 'deals';

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white overflow-x-auto">
        {CRM_TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/crm${tab.path ? `/${tab.path}` : ''}`}
            className={`px-3 py-1.5 text-[13px] rounded-md transition ${
              activeKey === tab.key
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </Link>
        ))}
        {/* End-side slot (left in RTL): the active tab may portal WORKSPACE-LEVEL
            controls here — e.g. the Tasks workspace's owner/stage/status filters —
            keeping its own toolbar for task-level work. Empty for tabs that don't
            use it; the layout stays generic. */}
        <div id="crm-tabrow-slot" className="ms-auto flex shrink-0 items-center gap-1.5" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
