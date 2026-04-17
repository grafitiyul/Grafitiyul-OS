import { Outlet, Link, useLocation } from 'react-router-dom';
import { TABS } from './config.js';

export default function ProceduresLayout() {
  const { pathname } = useLocation();
  const activeKey =
    TABS.find((t) => pathname.startsWith(`/admin/procedures/${t.path}`))?.key ||
    TABS[0].key;

  return (
    <div className="h-full flex">
      {/* List pane: full width on mobile, fixed width on desktop */}
      <aside className="w-full lg:w-[360px] lg:shrink-0 lg:border-l lg:border-gray-200 bg-white flex flex-col min-h-0">
        {/* Desktop-only tab switcher */}
        <div className="hidden lg:block p-2 border-b border-gray-200 bg-gray-50/60">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <Link
                key={tab.key}
                to={`/admin/procedures/${tab.path}`}
                className={`flex-1 text-center px-2 py-2 text-[13px] rounded-md transition ${
                  activeKey === tab.key
                    ? 'bg-white border border-gray-200 font-semibold text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:bg-white/70'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </aside>

      {/* Work area — desktop only in slice 1 (no entity selection yet) */}
      <section className="hidden lg:flex flex-1 items-center justify-center p-10 bg-gray-50">
        <WorkAreaEmpty activeKey={activeKey} />
      </section>
    </div>
  );
}

function WorkAreaEmpty({ activeKey }) {
  const title = {
    flows: 'בחרו זרימה לעריכה',
    bank: 'בחרו פריט לעריכה',
    approvals: 'בחרו תשובה לאישור',
  }[activeKey];
  const sub = {
    flows: 'הרשימה מימין מציגה את כל הזרימות',
    bank: 'הרשימה מימין מציגה את כל הפריטים בבנק',
    approvals: 'הרשימה מימין מציגה תשובות הממתינות לאישור',
  }[activeKey];

  return (
    <div className="text-center max-w-sm">
      <div className="text-5xl mb-5 opacity-40">◎</div>
      <div className="text-lg font-semibold text-gray-800 mb-1">{title}</div>
      <div className="text-sm text-gray-500">{sub}</div>
    </div>
  );
}
