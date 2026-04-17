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
        <main className="flex-1 min-w-0 pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
