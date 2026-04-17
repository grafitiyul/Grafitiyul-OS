import { Outlet, Link, useLocation } from 'react-router-dom';
import { TABS } from './config.js';

// The procedures module's top-level layout: a desktop tab switcher header
// and an outlet that each tab component fills with its own list/work-area
// layout. Keeps the shell simple and lets every tab own its own structure.
export default function ProceduresLayout() {
  const { pathname } = useLocation();
  const activeKey =
    TABS.find((t) => pathname.startsWith(`/admin/procedures/${t.path}`))?.key ||
    TABS[0].key;

  return (
    <div className="h-full flex flex-col">
      {/* Desktop-only tab switcher. On mobile, the bottom tab bar handles nav. */}
      <div className="hidden lg:flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/procedures/${tab.path}`}
            className={`px-3 py-1.5 text-[13px] rounded-md transition ${
              activeKey === tab.key
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
