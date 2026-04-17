import { NavLink } from 'react-router-dom';
import { TABS } from '../admin/procedures/config.js';

// Mobile-only bottom tab bar. The three procedures tabs sit here directly,
// because on mobile we skip the module-level nav rail for a tighter flow.
export default function MobileTabBar() {
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex h-16 z-40"
      style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.04)' }}
      aria-label="ניווט תחתון"
    >
      {TABS.map((t) => (
        <NavLink
          key={t.key}
          to={`/admin/procedures/${t.path}`}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center text-[11px] leading-tight gap-1 ${
              isActive ? 'text-blue-600 font-semibold' : 'text-gray-500'
            }`
          }
        >
          <span className="text-lg leading-none">{t.glyph}</span>
          <span className="px-1 text-center">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
