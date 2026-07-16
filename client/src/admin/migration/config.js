// Migration Review Center — TEMPORARY one-time migration tool.
//
// Tab order IS the approved information architecture. Units are created inside
// the Organizations workflow (no Units tab); phone evidence lives inside the
// Contacts duplicate flow (no phone tab).
//
// DELETION BOUNDARY: this whole directory (client/src/admin/migration/), its one
// route block in App.jsx, and its one nav entry in shell/moduleRoutes.js are
// removed after cutover.
export const MIGRATION_TABS = [
  { key: 'organizations', path: 'organizations', label: 'ארגונים' },
  { key: 'contacts', path: 'contacts', label: 'אנשי קשר' },
  { key: 'name_cleanup', path: 'name-cleanup', label: 'ניקוי שמות' },
  { key: 'stage_config', path: 'stage-config', label: 'שלבים והגדרות' },
  { key: 'deals', path: 'deals', label: 'עסקאות' },
  { key: 'exceptional', path: 'exceptional', label: 'רשומות חריגות' },
  { key: 'legacy_archive', path: 'legacy-archive', label: 'ארכיון מערכת קודמת' },
];

// path → queue key, so the layout can highlight the active tab.
export const tabForPath = (pathname) =>
  MIGRATION_TABS.find((t) => pathname.startsWith(`/admin/migration/${t.path}`)) || null;
