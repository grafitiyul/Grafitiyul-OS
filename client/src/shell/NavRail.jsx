import { NavLink } from 'react-router-dom';

// Sidebar modules. Top group = daily/frequent operational work. Bottom group =
// less-frequent utility/config, pushed to the bottom by a spacer. Keyed by
// stable internal keys — never by the Hebrew label.
const TOP_MODULES = [
  { key: 'people', to: '/admin/people', label: 'אנשים וגישה', glyph: '👥' },
  // CRM is the operational hub: Deals (primary tab) + Contacts + Organizations.
  { key: 'crm', to: '/admin/crm', label: 'CRM', glyph: '🏢' },
];

// Bottom cluster, top→bottom: מסמכים, נהלים, הגדרות, משתמשים.
const BOTTOM_MODULES = [
  { key: 'documents', to: '/admin/documents', label: 'מסמכים', glyph: '📄' },
  { key: 'procedures', to: '/admin/procedures', label: 'נהלים', glyph: '☰' },
  { key: 'settings', to: '/admin/settings', label: 'הגדרות', glyph: '⚙️' },
  { key: 'users', to: '/admin/users', label: 'משתמשים', glyph: '🔐' },
];

function Item({ to, glyph, label }) {
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
      <span className="text-xl leading-none">{glyph}</span>
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
