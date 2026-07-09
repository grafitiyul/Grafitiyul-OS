// Shared module registry — the single source of truth for both the sidebar
// (NavRail) and the TopBar breadcrumb. Keyed by stable internal keys, never by
// the Hebrew label, so navigation and the header label can never drift apart.
//
// `glyph` is an emoji; an optional `Icon` component (real brand mark, shared
// with the rest of the app) takes precedence in NavRail. No JSX here — this
// file is .js and only passes component references.

import WhatsAppLogo from '../admin/common/WhatsAppLogo.jsx';
import GmailIcon from '../admin/common/icons/GmailIcon.jsx';

export const TOP_MODULES = [
  // CRM is the operational hub: Deals (primary tab) + Contacts + Organizations.
  { key: 'crm', to: '/admin/crm', label: 'CRM', glyph: '🏢' },
  // The active WhatsApp inbox (conversations → deals) + connection management.
  // A working surface, not a setting — hence a top-level module.
  { key: 'whatsapp', to: '/admin/whatsapp', label: 'WhatsApp', glyph: '💬', Icon: WhatsAppLogo },
  // The email inbox (Gmail mirror → deals) + account management. Same
  // working-surface reasoning as WhatsApp.
  { key: 'email', to: '/admin/email', label: 'אימייל', glyph: '📧', Icon: GmailIcon },
];

// Bottom cluster, top→bottom: גבייה, צוות, תוכן סיורים, מסמכים, נהלים, הגדרות,
// משתמשים. "צוות" (the people/access module) moved here — it reflects its real
// purpose as the staff/team surface; route (/admin/people) unchanged.
export const BOTTOM_MODULES = [
  // Collection — WON deals that still owe money (server Collection service).
  { key: 'collection', to: '/admin/collection', label: 'גבייה', glyph: '💰' },
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
