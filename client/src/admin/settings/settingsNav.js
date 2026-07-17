// Shared settings-navigation model — ONE source of truth for the settings
// breadcrumb + smart "back" button. Never hand-roll a per-page back link.
//
// Two parts:
//   1. SETTINGS_TREE — the page hierarchy (path → { label, parent }). Drives the
//      breadcrumb trail AND the parent fallback for "back".
//   2. An in-session visit stack — so "back" returns to the PREVIOUS settings
//      location actually visited this session; on a deep link / fresh load the
//      stack is empty and back falls back to the tree parent.

export const SETTINGS_ROOT = '/admin/settings';

// path → { label, parent }. Dynamic detail routes (…/products/:id) are resolved
// at runtime by resolveNode() with a caller-supplied label.
export const SETTINGS_TREE = {
  '/admin/settings': { label: 'הגדרות', parent: null },
  '/admin/settings/crm': { label: 'הגדרות CRM', parent: '/admin/settings' },
  '/admin/settings/crm/organization-types': { label: 'סוגי ארגון ותת-סוגים', parent: '/admin/settings/crm' },
  '/admin/settings/crm/deal-stages': { label: 'שלבי דיל', parent: '/admin/settings/crm' },
  '/admin/settings/crm/lost-reasons': { label: 'סיבות LOST', parent: '/admin/settings/crm' },
  '/admin/settings/crm/deal-sources': { label: 'מקורות דיל', parent: '/admin/settings/crm' },
  '/admin/settings/crm/task-types': { label: 'סוגי משימות', parent: '/admin/settings/crm' },
  '/admin/settings/crm/quote-sections': { label: 'הצעות מחיר', parent: '/admin/settings/crm' },
  '/admin/settings/crm/quote-layout': { label: 'מבנה הצעת מחיר', parent: '/admin/settings/crm' },
  '/admin/settings/crm/products-area': { label: 'מוצרים', parent: '/admin/settings/crm' },
  '/admin/settings/crm/products': { label: 'מוצרים ראשיים', parent: '/admin/settings/crm/products-area' },
  '/admin/settings/crm/locations': { label: 'מיקומים', parent: '/admin/settings/crm/products-area' },
  '/admin/settings/crm/addons': { label: 'תוספות', parent: '/admin/settings/crm/products-area' },
  '/admin/settings/crm/payment': { label: 'הגדרות תשלום', parent: '/admin/settings/crm' },
  '/admin/settings/crm/pricing': { label: 'תמחור', parent: '/admin/settings/crm' },
  '/admin/settings/crm/pricing/advanced': { label: 'תמחור מתקדם', parent: '/admin/settings/crm/pricing' },
  '/admin/settings/crm/ticket-types': { label: 'סוגי כרטיסים', parent: '/admin/settings/crm' },
  '/admin/settings/crm/sabbath-hours': { label: 'שעות שבת וחג', parent: '/admin/settings/crm' },
  '/admin/settings/crm/shared-content': { label: 'ספריית תוכן משותף', parent: '/admin/settings/crm' },
  '/admin/settings/finance': { label: 'הגדרות כספים', parent: '/admin/settings' },
  '/admin/settings/finance/payroll-components': { label: 'רכיבי שכר', parent: '/admin/settings/finance' },
  '/admin/settings/finance/activity-types': { label: 'סוגי תוספת כללית', parent: '/admin/settings/finance' },
  '/admin/settings/tours': { label: 'הגדרות סיורים', parent: '/admin/settings' },
  '/admin/settings/tours/open-tours': { label: 'סיורים פתוחים', parent: '/admin/settings/tours' },
  '/admin/settings/tours/components': { label: 'מרכיבי הפעילות ומיקומי הסדנה', parent: '/admin/settings/tours' },
  '/admin/settings/tours/coordination': { label: 'שיחת תיאום', parent: '/admin/settings/tours' },
  '/admin/settings/tours/summary': { label: 'סיכום סיור', parent: '/admin/settings/tours' },
  '/admin/settings/tours/guide-permissions': { label: 'הרשאות מדריכים', parent: '/admin/settings/tours' },
};

// Resolve a node for a pathname. Static paths come from the tree; the dynamic
// product-detail route (…/products/<id>) is synthesised with the caller's label
// and the products list as its parent.
export function resolveNode(pathname, dynamicLabel) {
  if (SETTINGS_TREE[pathname]) return { path: pathname, ...SETTINGS_TREE[pathname] };
  if (/^\/admin\/settings\/crm\/products\/[^/]+$/.test(pathname)) {
    return { path: pathname, label: dynamicLabel || 'מוצר', parent: '/admin/settings/crm/products' };
  }
  // Variant editor (…/products/:id/variant/:variantId): its "back" falls to the
  // parent product page. The dedicated editor renders its own header, so the
  // breadcrumb here matters only for the back-fallback.
  const variantMatch = pathname.match(/^(\/admin\/settings\/crm\/products\/[^/]+)\/variant\/[^/]+$/);
  if (variantMatch) {
    return { path: pathname, label: dynamicLabel || 'וריאציה', parent: variantMatch[1] };
  }
  return null;
}

// Full breadcrumb trail (root → current). Unknown paths yield a single crumb.
export function getTrail(pathname, dynamicLabel) {
  const trail = [];
  let node = resolveNode(pathname, dynamicLabel);
  const guard = new Set();
  while (node && !guard.has(node.path)) {
    guard.add(node.path);
    trail.unshift({ path: node.path, label: node.label });
    node = node.parent && SETTINGS_TREE[node.parent] ? { path: node.parent, ...SETTINGS_TREE[node.parent] } : null;
  }
  return trail;
}

// Parent path for the "back" fallback (settings root if unknown).
export function parentOf(pathname, dynamicLabel) {
  return resolveNode(pathname, dynamicLabel)?.parent || SETTINGS_ROOT;
}

// ── In-session visit stack (module-scoped; resets on full page reload) ────────
let stack = [];

// Record a settings visit. Consecutive duplicates are ignored; returning to a
// path already deeper in the stack trims it (so back never loops forward).
export function recordSettingsVisit(path) {
  if (stack[stack.length - 1] === path) return;
  const existing = stack.lastIndexOf(path);
  if (existing !== -1) stack = stack.slice(0, existing + 1);
  else stack.push(path);
}

// The settings path visited immediately before `path`, or null if none.
export function previousSettingsPath(path) {
  const idx = stack.lastIndexOf(path);
  return idx > 0 ? stack[idx - 1] : null;
}

// Test-only reset of the module stack.
export function __resetSettingsHistory() {
  stack = [];
}
