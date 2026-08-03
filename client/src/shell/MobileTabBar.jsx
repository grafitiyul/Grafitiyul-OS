import { NavLink } from 'react-router-dom';
import { useResolvedNav } from './navConfig.jsx';

// Mobile bottom navigation = the mobile form of the global NavRail. It renders
// the SAME resolved navigation (navResolve.js — registry + the administrator's
// stored preferences) as the desktop side rail, so GOS has ONE global
// navigation, identical in the browser and in the installed (standalone) admin
// PWA. The bar still scrolls horizontally if the configured rail is wider than
// the phone; every module in the rail stays reachable exactly as on desktop,
// and modules kept out of the rail live in Settings → מודולים לניהול.
//
// This bar previously hard-coded the Procedures module's local tabs
// (admin/procedures/config.js → /admin/procedures/*), a leftover from when GOS
// WAS only the Procedures module. That made the narrow-viewport / PWA app look
// like a Procedures-only application. Module-local tabs belong INSIDE their
// module (see ProceduresLayout), never in the shell's global navigation.
export default function MobileTabBar() {
  const { rail } = useResolvedNav();
  return (
    <nav
      // Safe-area: on notched phones (PWA standalone especially) the bar must
      // not sit under the home indicator — the inset pads it, and AppShell's
      // main padding grows by the same amount.
      className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex overflow-x-auto no-scrollbar z-40"
      style={{
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label="ניווט ראשי"
    >
      {rail.map((m) => (
        <NavLink
          key={m.key}
          to={m.to}
          className={({ isActive }) =>
            `shrink-0 basis-[4.5rem] h-16 flex flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight ${
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
