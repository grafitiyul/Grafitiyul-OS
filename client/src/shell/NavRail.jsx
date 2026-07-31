import { NavLink } from 'react-router-dom';
import { useResolvedNav } from './navConfig.jsx';

// Sidebar modules. Top group = daily/frequent operational work. Bottom group =
// less-frequent administrative modules, pushed to the bottom by a spacer.
//
// Both groups are RESOLVED (navResolve.js) from the code registry plus the
// administrator's stored preferences, so which modules appear and in what order
// is configured at /admin/settings/navigation — never edited in code. Modules
// kept out of the rail stay reachable from Settings → מודולים לניהול.

function Item({ to, glyph, label, Icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 py-3 text-[11px] leading-tight transition ${
          isActive
            ? 'text-white bg-gray-800'
            : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
        }`
      }
    >
      {/* Brand-mark modules render their real logo; the rest keep emoji. The
          span box matches text-xl line height so both align identically. */}
      <span className="flex h-5 items-center justify-center text-xl leading-none">
        {Icon ? <Icon size={20} /> : glyph}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

export default function NavRail() {
  const { primary, utility } = useResolvedNav();
  return (
    <nav
      className="hidden lg:flex w-20 shrink-0 bg-gray-900 text-gray-300 border-l border-gray-800 flex-col items-stretch py-3"
      aria-label="ניווט ראשי"
    >
      {primary.map((m) => (
        <Item key={m.key} {...m} />
      ))}
      <div className="flex-1" />
      {utility.map((m) => (
        <Item key={m.key} {...m} />
      ))}
    </nav>
  );
}
