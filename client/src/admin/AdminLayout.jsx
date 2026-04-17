import { Outlet, NavLink } from 'react-router-dom';

export default function AdminLayout() {
  const linkCls = ({ isActive }) =>
    `px-3 py-2 rounded text-sm ${
      isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
    }`;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white px-6 py-3 flex items-center gap-4">
        <div className="font-bold">Grafitiyul OS</div>
        <nav className="flex gap-1">
          <NavLink end to="/admin" className={linkCls}>Flows</NavLink>
          <NavLink to="/admin/bank" className={linkCls}>Item Bank</NavLink>
        </nav>
      </header>
      <main className="flex-1 bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
