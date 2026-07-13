import { Outlet, Link, useLocation } from 'react-router-dom';
import { CRM_TABS } from './config.js';

// Top-level layout for the CRM module. Mirrors PeopleLayout / ProceduresLayout
// so the shell, desktop tabs, and mobile tab bar stay consistent.
export default function CrmLayout() {
  const { pathname } = useLocation();
  const activeKey = pathname.startsWith('/admin/crm/contacts')
    ? 'contacts'
    : pathname.startsWith('/admin/crm/organizations')
      ? 'organizations'
      : 'deals';

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
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
