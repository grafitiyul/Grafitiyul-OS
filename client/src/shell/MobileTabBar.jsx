import { NavLink } from 'react-router-dom';
import { ALL_MODULES } from './modules.js';

// Mobile bottom navigation = the mobile form of the global NavRail. It renders
// the SAME module registry (modules.js) as the desktop side rail, so GOS has
// ONE global navigation — identical in the browser and in the installed
// (standalone) admin PWA. The full module set is wider than a phone, so the bar
// scrolls horizontally; every module stays reachable exactly as on desktop.
//
// This bar previously hard-coded the Procedures module's local tabs
// (admin/procedures/config.js → /admin/procedures/*), a leftover from when GOS
// WAS only the Procedures module. That made the narrow-viewport / PWA app look
// like a Procedures-only application. Module-local tabs belong INSIDE their
// module (see ProceduresLayout), never in the shell's global navigation.
export default function MobileTabBar() {
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex overflow-x-auto h-16 z-40"
      style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.04)' }}
      aria-label="ניווט ראשי"
    >
      {ALL_MODULES.map((m) => (
        <NavLink
          key={m.key}
          to={m.to}
          className={({ isActive }) =>
            `shrink-0 basis-[4.5rem] flex flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight ${
              isActive ? 'text-blue-600 font-semibold' : 'text-gray-500'
            }`
          }
        >
          <span className="flex h-5 items-center justify-center text-lg leading-none">
            {m.Icon ? <m.Icon size={20} /> : m.glyph}
          </span>
          <span className="whitespace-nowrap">{m.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
