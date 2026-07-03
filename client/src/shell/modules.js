// Shared module registry — the single source of truth for both the sidebar
// (NavRail) and the TopBar breadcrumb. Keyed by stable internal keys, never by
// the Hebrew label, so navigation and the header label can never drift apart.

export const TOP_MODULES = [
  // CRM is the operational hub: Deals (primary tab) + Contacts + Organizations.
  { key: 'crm', to: '/admin/crm', label: 'CRM', glyph: '🏢' },
];

// Bottom cluster, top→bottom: צוות, תוכן סיורים, מסמכים, נהלים, הגדרות, משתמשים.
// "צוות" (the people/access module) moved here — it reflects its real purpose as
// the staff/team surface; route (/admin/people) unchanged.
export const BOTTOM_MODULES = [
  { key: 'people', to: '/admin/people', label: 'צוות', glyph: '👥' },
  { key: 'tour-content', to: '/admin/tour-content', label: 'תוכן סיורים', glyph: '🗺️' },
  { key: 'documents', to: '/admin/documents', label: 'מסמכים', glyph: '📄' },
  { key: 'procedures', to: '/admin/procedures', label: 'נהלים', glyph: '☰' },
  { key: 'settings', to: '/admin/settings', label: 'הגדרות', glyph: '⚙️' },
  { key: 'users', to: '/admin/users', label: 'משתמשים', glyph: '🔐' },
];

export const ALL_MODULES = [...TOP_MODULES, ...BOTTOM_MODULES];

// Resolve the active module from a pathname by longest-prefix match, so
// /admin/crm/deals/123 correctly maps to the CRM module (not "נהלים").
export function moduleForPath(pathname) {
  return (
    ALL_MODULES
      .filter((m) => pathname === m.to || pathname.startsWith(m.to + '/'))
      .sort((a, b) => b.to.length - a.to.length)[0] || null
  );
}
