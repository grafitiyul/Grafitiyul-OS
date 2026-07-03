import { NavLink, Outlet } from 'react-router-dom';

// Top-level layout for the Tour Content module. Two areas:
//   • סיורים        — tours → stations → steps
//   • ספריית תוכן   — reusable content blocks library
// The learner/portal runtime is a separate surface; this is admin authoring only.
export default function TourContentLayout() {
  const tab = (to, label) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 text-sm rounded-lg ${
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100'
        }`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div dir="rtl" className="h-full flex flex-col">
      <div className="shrink-0 border-b border-gray-200 px-4 sm:px-6 pt-4 pb-2">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">תוכן סיורים</h1>
        <nav className="flex items-center gap-1">
          {tab('/admin/tour-content/tours', 'סיורים')}
          {tab('/admin/tour-content/blocks', 'ספריית תוכן')}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <Outlet />
      </div>
    </div>
  );
}
