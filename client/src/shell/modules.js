// Shared module registry — the single source of truth for the sidebar
// (NavRail), the mobile bottom bar (MobileTabBar), the TopBar breadcrumb and
// the Settings module grid.
//
// The pure route metadata (keys, routes, labels, glyphs, rail defaults) +
// moduleForPath live in ./moduleRoutes.js (no JSX, so they're testable and
// importable anywhere). Here we decorate the two entries that render a real
// brand mark with their icon component. Rendering consumers import from THIS
// file; logic-only consumers and tests import from ./moduleRoutes.js.
//
// What is rendered is never this list directly — it is resolveNav(registry,
// preferences) (see ./navResolve.js), so an administrator can reorder and hide
// modules without a code change.

import WhatsAppLogo from '../admin/common/WhatsAppLogo.jsx';
import GmailIcon from '../admin/common/icons/GmailIcon.jsx';
import {
  MODULE_REGISTRY as MODULE_REGISTRY_ROUTES,
  TOP_MODULES as TOP_MODULE_ROUTES,
  BOTTOM_MODULES as BOTTOM_MODULE_ROUTES,
  moduleForPath,
} from './moduleRoutes.js';

// key → brand-icon component. An `Icon` (when present) takes precedence over
// `glyph` in NavRail / MobileTabBar / the Settings module cards.
const MODULE_ICONS = {
  whatsapp: WhatsAppLogo,
  email: GmailIcon,
};

const withIcons = (list) =>
  list.map((m) => (MODULE_ICONS[m.key] ? { ...m, Icon: MODULE_ICONS[m.key] } : m));

export const MODULE_REGISTRY = withIcons(MODULE_REGISTRY_ROUTES);
export const TOP_MODULES = withIcons(TOP_MODULE_ROUTES);
export const BOTTOM_MODULES = withIcons(BOTTOM_MODULE_ROUTES);
export const ALL_MODULES = MODULE_REGISTRY;

export { moduleForPath };
