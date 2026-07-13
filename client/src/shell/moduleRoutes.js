// Pure module route metadata — the single source of truth for the global admin
// navigation registry, with NO JSX/icon imports so it is importable anywhere
// (and unit-testable under `node --test`, which does not transpile JSX).
//
// modules.js decorates two entries (whatsapp, email) with brand-icon components
// for rendering. Components that render icons import from modules.js; logic-only
// consumers and tests import from here.
//
// Both the desktop NavRail and the mobile MobileTabBar map this SAME registry,
// so GOS has ONE global navigation — identical in the browser and in the
// installed (standalone) admin PWA.

export const TOP_MODULES = [
  // בקרה — operations control center and the admin LANDING page.
  { key: 'control', to: '/admin/control', label: 'בקרה', glyph: '🚨' },
  // CRM hub: Deals (primary) + Contacts + Organizations.
  { key: 'crm', to: '/admin/crm', label: 'CRM', glyph: '🏢' },
  // Tours — operational execution module (TourEvent/Booking).
  { key: 'tours', to: '/admin/tours', label: 'סיורים', glyph: '🧭' },
  // WhatsApp inbox + connections (icon added in modules.js).
  { key: 'whatsapp', to: '/admin/whatsapp', label: 'WhatsApp', glyph: '💬' },
  // Email inbox + Gmail account management (icon added in modules.js).
  { key: 'email', to: '/admin/email', label: 'אימייל', glyph: '📧' },
];

export const BOTTOM_MODULES = [
  { key: 'finance', to: '/admin/finance', label: 'כספים', glyph: '💰' },
  { key: 'people', to: '/admin/people', label: 'צוות', glyph: '👥' },
  { key: 'tour-content', to: '/admin/tour-content', label: 'תוכן סיורים', glyph: '🗺️' },
  { key: 'documents', to: '/admin/documents', label: 'מסמכים', glyph: '📄' },
  { key: 'procedures', to: '/admin/procedures', label: 'נהלים', glyph: '☰' },
  { key: 'questionnaires', to: '/admin/questionnaires', label: 'שאלונים', glyph: '📋' },
  { key: 'settings', to: '/admin/settings', label: 'הגדרות', glyph: '⚙️' },
  { key: 'users', to: '/admin/users', label: 'משתמשים', glyph: '🔐' },
];

export const ALL_MODULES = [...TOP_MODULES, ...BOTTOM_MODULES];

// Resolve the active module from a pathname by longest-prefix match, so
// /admin/crm/deals/123 maps to CRM (not "נהלים"), and "tours" never swallows
// "tour-content".
export function moduleForPath(pathname) {
  return (
    ALL_MODULES
      .filter((m) => pathname === m.to || pathname.startsWith(m.to + '/'))
      .sort((a, b) => b.to.length - a.to.length)[0] || null
  );
}
