// The ONE navigation resolver. Merges the code registry (moduleRoutes.js —
// module identity) with the stored administrator preferences (NavPreference —
// module presentation) into the exact lists that get rendered.
//
// NavRail, MobileTabBar and the Settings module grid ALL call this. There is
// deliberately no second implementation: a screen that computed its own
// visibility would be the bug where a module is hidden from the rail and also
// missing from Settings, i.e. unreachable.
//
// Invariants this file guarantees:
//   1. The registry is the universe. Preferences only decorate it — a stored
//      row for a module that no longer exists in code is ignored, never a crash.
//   2. Pinned modules are always in the rail, whatever the preferences say.
//      (Hiding הגדרות would hide the screen that unhides everything else.)
//   3. A module with no stored preference keeps its code defaults and sorts
//      AFTER every configured module, in registry order — so a newly added
//      module appears by itself, with no seed row and no data migration.
//   4. rail ∪ settings grid = every module. Nothing can become unreachable.
//
// `userPrefs` is accepted and merged today as a no-op (always null): navigation
// is an org-wide setting. Per-user overrides later are a merge here plus a
// UserUiState key — no change at any call site.

// Unconfigured modules sort after configured ones. Any real sortOrder written
// by the settings screen is a small index (0…n), so this never collides.
const UNCONFIGURED_ORDER_BASE = 100000;

const RAIL_GROUPS = ['primary', 'utility'];

function prefMap(prefs) {
  const map = new Map();
  for (const p of Array.isArray(prefs) ? prefs : []) {
    if (p && typeof p.key === 'string') map.set(p.key, p);
  }
  return map;
}

// One module + its effective presentation. Exported for the settings screen,
// which needs the same merge before the user has saved anything.
export function decorateModules(registry, orgPrefs, userPrefs = null) {
  const org = prefMap(orgPrefs);
  const user = prefMap(userPrefs);
  return registry.map((m, registryIndex) => {
    // A user override beats the org default beats the code default.
    const p = { ...(org.get(m.key) || {}), ...(user.get(m.key) || {}) };
    const configured = Object.keys(p).length > 0;
    return {
      ...m,
      // Pinned wins over any stored value — invariant 2.
      inNav: m.pinned ? true : typeof p.inNav === 'boolean' ? p.inNav : m.defaultInNav !== false,
      railGroup: RAIL_GROUPS.includes(p.railGroup) ? p.railGroup : m.railGroup,
      sortOrder: Number.isFinite(p.sortOrder)
        ? p.sortOrder
        : UNCONFIGURED_ORDER_BASE + registryIndex,
      registryIndex,
      configured,
    };
  });
}

// → { primary, utility, rail, hidden, all } — all arrays of decorated modules,
// each already in render order.
export function resolveNav(registry, orgPrefs, userPrefs = null) {
  const all = decorateModules(registry, orgPrefs, userPrefs).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.registryIndex - b.registryIndex,
  );
  const primary = all.filter((m) => m.inNav && m.railGroup === 'primary');
  const utility = all.filter((m) => m.inNav && m.railGroup === 'utility');
  return { all, primary, utility, rail: [...primary, ...utility], hidden: all.filter((m) => !m.inNav) };
}

// The module cards shown in Settings → "מודולים לניהול".
//
// EVERY full module appears here, including the ones currently in the nav rail:
// this section is a permanent second entry point to all modules, not a holding
// area for hidden ones. That is also what makes invariant 4 unconditional —
// whatever the administrator hides, its card is already here.
//
// הגדרות is the one exclusion: a card linking to the page you are already on is
// noise, and it is pinned into the rail anyway, so it stays reachable.
//
// Management modules lead, because Settings is their home; the operational
// modules follow.
export function settingsModules(resolved) {
  const cards = resolved.all.filter((m) => m.key !== 'settings');
  return [...cards.filter((m) => m.management), ...cards.filter((m) => !m.management)];
}

// The payload the settings screen saves: an explicit row per module, so order
// is fully determined and no longer depends on registry position.
export function toPreferencePayload(modules) {
  return modules.map((m, i) => ({
    key: m.key,
    inNav: !!m.inNav,
    railGroup: m.railGroup,
    sortOrder: i,
  }));
}
