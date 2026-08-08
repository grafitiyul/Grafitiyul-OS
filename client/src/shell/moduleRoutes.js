// Pure module route metadata — the single source of truth for the global admin
// navigation registry, with NO JSX/icon imports so it is importable anywhere
// (and unit-testable under `node --test`, which does not transpile JSX).
//
// modules.js decorates two entries (whatsapp, email) with brand-icon components
// for rendering. Components that render icons import from modules.js; logic-only
// consumers and tests import from here.
//
// ── The architecture: code owns IDENTITY, the database owns PRESENTATION ──────
// A module is a CODE artifact: its route, label, glyph and component all live
// here. What an administrator can configure (navigation.js + the NavPreference
// table) is only its PRESENTATION — whether it sits in the nav rail, in which
// rail group, and in what order. Consequences that make this future-proof:
//   • adding a module stays a one-line change in this file,
//   • a stored preference can never point at a route that no longer exists,
//   • renaming or moving a route needs no data migration.
// navResolve.js merges the two layers; NavRail, MobileTabBar and the Settings
// module grid all render its ONE result.
//
// Per-entry fields:
//   railGroup    'primary'  — daily operational work, top of the rail.
//                'utility'  — administrative/less frequent, bottom of the rail.
//   defaultInNav whether the module ships visible in the rail (an administrator
//                can flip it either way; this is only the out-of-the-box value).
//   management   true = a complete management module that ALWAYS has a card in
//                Settings → "מודולים לניהול", whether or not it is in the rail.
//   pinned       cannot be hidden. Reserved for the escape hatches: הגדרות (it
//                holds the toggle that unhides everything else) and בקרה (the
//                admin landing route). Without this an admin can hide Settings
//                and lock themselves out of the screen that would restore it.
//   description  business-language one-liner for the Settings module card.

export const MODULE_REGISTRY = [
  // בקרה — operations control center and the admin LANDING page.
  {
    key: 'control',
    to: '/admin/control',
    label: 'בקרה',
    glyph: '🚨',
    railGroup: 'primary',
    defaultInNav: true,
    pinned: true,
    description: 'מה דורש טיפול עכשיו — חריגים ותקלות תפעוליות.',
  },
  {
    key: 'management-tasks',
    to: '/admin/management-tasks',
    label: 'משימות הנהלה',
    glyph: '📋',
    railGroup: 'primary',
    defaultInNav: true,
    description: 'תיבת הבקרה התפעולית — סיכומי סיור ודוחות לוגיסטיים לקריאה ואישור.',
  },
  // CRM hub: Deals (primary) + Contacts + Organizations.
  {
    key: 'crm',
    to: '/admin/crm',
    label: 'CRM',
    glyph: '🏢',
    railGroup: 'primary',
    defaultInNav: true,
    description: 'משימות, עסקאות, אנשי קשר וארגונים.',
  },
  // Tours — operational execution module (TourEvent/Booking).
  {
    key: 'tours',
    to: '/admin/tours',
    label: 'סיורים',
    glyph: '🧭',
    railGroup: 'primary',
    defaultInNav: true,
    description: 'לוח הסיורים, שיבוץ מדריכים והרשמות.',
  },
  // WhatsApp inbox + connections (icon added in modules.js).
  {
    key: 'whatsapp',
    to: '/admin/whatsapp',
    label: 'WhatsApp',
    glyph: '💬',
    railGroup: 'primary',
    defaultInNav: true,
    description: 'תיבת השיחות וחיבור מספרי הוואטסאפ.',
  },
  // Email inbox + Gmail account management (icon added in modules.js).
  {
    key: 'email',
    to: '/admin/email',
    label: 'אימייל',
    glyph: '📧',
    railGroup: 'primary',
    defaultInNav: true,
    description: 'תיבת המייל וחשבונות Gmail המחוברים.',
  },
  {
    key: 'finance',
    to: '/admin/finance',
    label: 'כספים',
    glyph: '💰',
    railGroup: 'utility',
    defaultInNav: true,
    description: 'גבייה, שכר צוות וניהול פיננסי.',
  },
  {
    key: 'settings',
    to: '/admin/settings',
    label: 'הגדרות',
    glyph: '⚙️',
    railGroup: 'utility',
    defaultInNav: true,
    pinned: true,
    description: 'תצורת המערכת וכניסה למודולי הניהול.',
  },

  // ── Management modules ───────────────────────────────────────────────────
  // Complete modules, not configuration screens. They ship OUT of the rail to
  // keep the main navigation short, and are always reachable from Settings →
  // "מודולים לניהול". Any of them can be added to the rail from
  // /admin/settings/navigation.
  {
    key: 'users',
    to: '/admin/users',
    label: 'משתמשים',
    glyph: '🔐',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'משתמשי המערכת, שמות תצוגה והרשאות כניסה.',
  },
  {
    key: 'questionnaires',
    to: '/admin/questionnaires',
    label: 'שאלונים',
    glyph: '📋',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'בניית שאלונים — סיכום סיור, שיחת תיאום וטפסים נוספים.',
  },
  {
    key: 'procedures',
    to: '/admin/procedures',
    label: 'נהלים',
    glyph: '📚',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'בנק הפריטים, זרימות הדרכה ואישור תשובות של הצוות.',
  },
  {
    key: 'documents',
    to: '/admin/documents',
    label: 'מסמכים',
    glyph: '📄',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'תבניות מסמכים, חותמים, שדות קבועים ומסמכים חתומים.',
  },
  {
    key: 'tour-content',
    to: '/admin/tour-content',
    label: 'תוכן סיורים',
    glyph: '🗺️',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'מסלולים, תחנות ותוכן ההדרכה שהמדריכים רואים בשטח.',
  },
  {
    key: 'people',
    to: '/admin/people',
    label: 'צוות',
    glyph: '👥',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'כרטיסי אנשי הצוות, צוותים, הכשרה והרשאות.',
  },
  {
    key: 'site-pages',
    to: '/admin/site-pages',
    label: 'דפי אתר',
    glyph: '🌐',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'עמודי תוכן של האתר הציבורי — כתיבה, פרסום וגרסאות.',
  },
  // סוכן AI — the WhatsApp agent's MANAGEMENT surface. Daily work stays in the
  // WhatsApp inbox; this module is where its knowledge, authority and quality
  // are governed. Ships out of the rail (like every management module) and is
  // always reachable from Settings.
  {
    key: 'ai-agent',
    to: '/admin/ai-agent',
    label: 'סוכן AI',
    glyph: '🤖',
    railGroup: 'utility',
    defaultInNav: false,
    management: true,
    description: 'הסוכן שעונה בוואטסאפ — ידע, הרשאות, אישור תשובות ואיכות.',
  },
];

// Back-compat exports. The rail's two groups are now RESOLVED at runtime from
// the registry + the stored preferences (navResolve.js) — these plain lists are
// the code-default view of the same data, used as the pre-config fallback and
// by logic that only needs module identity.
export const TOP_MODULES = MODULE_REGISTRY.filter(
  (m) => m.railGroup === 'primary' && m.defaultInNav !== false,
);
export const BOTTOM_MODULES = MODULE_REGISTRY.filter(
  (m) => m.railGroup === 'utility' && m.defaultInNav !== false,
);
export const ALL_MODULES = MODULE_REGISTRY;

// Resolve the active module from a pathname by longest-prefix match, so
// /admin/crm/deals/123 maps to CRM (not "נהלים"), and "tours" never swallows
// "tour-content".
//
// This deliberately searches the WHOLE registry, never the resolved rail: a
// module hidden from the navigation is still a real, reachable module, and its
// breadcrumb must keep working.
export function moduleForPath(pathname) {
  return (
    MODULE_REGISTRY
      .filter((m) => pathname === m.to || pathname.startsWith(m.to + '/'))
      .sort((a, b) => b.to.length - a.to.length)[0] || null
  );
}
