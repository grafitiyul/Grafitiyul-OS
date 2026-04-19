import { Outlet, Link, useLocation } from 'react-router-dom';
import { DOC_TABS } from './config.js';

// The documents module's top-level layout: desktop tab switcher on top,
// outlet for the active tab below. Mirrors ProceduresLayout.
export default function DocumentsLayout() {
  const { pathname } = useLocation();
  const activeKey =
    DOC_TABS.find((t) => pathname.startsWith(`/admin/documents/${t.path}`))?.key ||
    DOC_TABS[0].key;

  return (
    <div className="h-full flex flex-col">
      <div className="hidden lg:flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white">
        {DOC_TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/documents/${tab.path}`}
            className={`px-3 py-1.5 text-[13px] rounded-md transition ${
              activeKey === tab.key
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.glyph} {tab.label}
          </Link>
        ))}
      </div>
      {/* Mobile tabs — compact top bar since the global mobile tab bar is
          procedure-scoped. */}
      <div className="lg:hidden flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-white overflow-x-auto">
        {DOC_TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/documents/${tab.path}`}
            className={`shrink-0 px-3 py-1.5 text-[12px] rounded-md ${
              activeKey === tab.key
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600'
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
