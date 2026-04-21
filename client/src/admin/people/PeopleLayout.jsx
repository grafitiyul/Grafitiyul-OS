import { Outlet, Link, useLocation } from 'react-router-dom';
import { PEOPLE_TABS } from './config.js';

// Top-level layout for the guide management module. Mirrors the structure
// of ProceduresLayout so the shell, desktop tabs, and mobile tab bar all
// keep working consistently. The "מדריכים" tab is the default; "צוותים"
// hosts the lightweight TeamRef CRUD used to seed assignment targets.
export default function PeopleLayout() {
  const { pathname } = useLocation();
  const activeKey = pathname.startsWith('/admin/people/teams')
    ? 'teams'
    : 'guides';

  return (
    <div className="h-full flex flex-col">
      <div className="hidden lg:flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white">
        {PEOPLE_TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/people${tab.path ? `/${tab.path}` : ''}`}
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
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
