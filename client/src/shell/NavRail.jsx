import { NavLink } from 'react-router-dom';
import { TOP_MODULES, BOTTOM_MODULES } from './modules.js';

// Sidebar modules. Top group = daily/frequent operational work. Bottom group =
// less-frequent utility/config, pushed to the bottom by a spacer. The module
// lists live in ./modules.js so the TopBar breadcrumb shares the same source.

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
  return (
    <nav
      className="hidden lg:flex w-20 shrink-0 bg-gray-900 text-gray-300 border-l border-gray-800 flex-col items-stretch py-3"
      aria-label="ניווט ראשי"
    >
      {TOP_MODULES.map((m) => (
        <Item key={m.key} {...m} />
      ))}
      <div className="flex-1" />
      {BOTTOM_MODULES.map((m) => (
        <Item key={m.key} {...m} />
      ))}
    </nav>
  );
}
