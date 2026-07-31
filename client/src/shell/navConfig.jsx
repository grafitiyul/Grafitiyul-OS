import { createContext, useContext, useMemo, useState } from 'react';
import { MODULE_REGISTRY } from './modules.js';
import { resolveNav } from './navResolve.js';

// Navigation configuration for the whole admin tree.
//
// The stored preferences arrive with the mount-time auth check (AdminGuard's
// GET /api/auth/status) rather than a second fetch, so the rail renders once,
// correctly, with no reorder flash — and nothing new needs cache rules: that
// request is already `no-store`.
//
// The provider holds the preferences in state so the settings screen can push a
// save straight into it; the rail updates immediately, without a reload.

const NavConfigContext = createContext(null);

export function NavConfigProvider({ initialPrefs, children }) {
  const [prefs, setPrefs] = useState(initialPrefs || []);
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs]);
  return <NavConfigContext.Provider value={value}>{children}</NavConfigContext.Provider>;
}

// Raw preferences + the setter. For the settings screen; render surfaces want
// useResolvedNav() instead.
export function useNavConfig() {
  return useContext(NavConfigContext) || { prefs: [], setPrefs: () => {} };
}

// The resolved navigation — what NavRail, MobileTabBar and the Settings module
// grid render. Outside a provider (or before the config lands) this falls back
// to the code registry's defaults, which is a complete, working navigation.
export function useResolvedNav() {
  const { prefs } = useNavConfig();
  return useMemo(() => resolveNav(MODULE_REGISTRY, prefs), [prefs]);
}

// Persist the navigation configuration. Returns the saved rows so the caller can
// push them into the provider.
export async function saveNavConfig(modules) {
  const res = await fetch('/api/nav/config', {
    method: 'PUT',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modules }),
  });
  if (!res.ok) throw new Error('nav_save_failed');
  const data = await res.json();
  return data.modules || [];
}

// Drop every stored preference — the navigation returns to the code defaults.
export async function resetNavConfig() {
  const res = await fetch('/api/nav/config', {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('nav_reset_failed');
  return [];
}
