import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import NavRail from './NavRail.jsx';
import TopBar from './TopBar.jsx';
import MobileTabBar from './MobileTabBar.jsx';
import VersionGate from './VersionGate.jsx';
import { moduleForPath } from './moduleRoutes.js';
import { applyModuleFavicon, resetModuleFavicon } from './moduleFavicon.js';

export default function AppShell() {
  const { pathname } = useLocation();

  // Browser-tab favicon follows the open module (AppShell mounts once for the
  // whole admin session, so this is the single owner of the tab icon). Leaving
  // /admin/* unmounts the shell and restores the brand favicon — public pages
  // and the guide portal are never affected. PWA icons are untouched.
  useEffect(() => {
    applyModuleFavicon(moduleForPath(pathname));
  }, [pathname]);
  useEffect(() => resetModuleFavicon, []);

  return (
    <div className="h-full flex flex-col">
      {/* Deploy-update surface — scoped to the authenticated internal workspace.
          AppShell renders only behind AdminGuard (the /admin/* tree), so the
          "גרסה חדשה זמינה" banner + safe auto-reload run for admins/staff and
          never on public/external pages. */}
      <VersionGate />
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <NavRail />
        {/* main is the scroll container so the NavRail (its sibling in this
            viewport-bounded row) stays fixed for the full height. Layout pages
            that already wrap content in their own overflow-y-auto are unaffected
            (their h-full child fits main exactly, so main itself doesn't scroll). */}
        <main className="flex-1 min-w-0 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
