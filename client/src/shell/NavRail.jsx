import { NavLink } from 'react-router-dom';

// Modules are keyed by stable internal keys — never by the Hebrew label.
const MODULES = [
  { key: 'procedures', to: '/admin/procedures', label: 'נהלים', glyph: '☰' },
  { key: 'people', to: '/admin/people', label: 'אנשים', glyph: '👥' },
  { key: 'documents', to: '/admin/documents', label: 'מסמכים', glyph: '📄' },
];

export default function NavRail() {
  return (
    <nav
      className="hidden lg:flex w-20 shrink-0 bg-gray-900 text-gray-300 border-l border-gray-800 flex-col items-stretch py-3"
      aria-label="ניווט ראשי"
    >
      {MODULES.map((m) => (
        <NavLink
          key={m.key}
          to={m.to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 py-3 text-[11px] leading-tight transition ${
              isActive
                ? 'text-white bg-gray-800'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`
          }
        >
          <span className="text-xl leading-none">{m.glyph}</span>
          <span>{m.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
