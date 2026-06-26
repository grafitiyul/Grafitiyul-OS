import { Outlet } from 'react-router-dom';
import NavRail from './NavRail.jsx';
import TopBar from './TopBar.jsx';
import MobileTabBar from './MobileTabBar.jsx';

export default function AppShell() {
  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <NavRail />
        {/* main is the scroll container so the NavRail (its sibling in this
            viewport-bounded row) stays fixed for the full height. Layout pages
            that already wrap content in their own overflow-y-auto are unaffected
            (their h-full child fits main exactly, so main itself doesn't scroll). */}
        <main className="flex-1 min-w-0 overflow-y-auto pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
