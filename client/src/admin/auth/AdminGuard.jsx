import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

// Admin auth gate. Wraps everything that lives under `/admin`. Three
// transient phases:
//
//   loading      — first /api/auth/status round-trip in flight
//   authed       — render <Outlet />
//   unauthed     — <Navigate> to /admin/login with returnTo=<current>
//
// Why a runtime check instead of just trusting a cookie's presence?
// HttpOnly session cookies can't be read from JS, so the only honest
// way to know whether we're logged in is to ask the server. That's a
// single GET on AppShell mount; subsequent admin API calls return
// their own 401s if the session expires mid-session, and the SPA can
// react to those (covered by `handleApiError` below — out of scope
// for this slice).
//
// We deliberately do NOT pre-fetch on every navigation between admin
// pages — the AppShell wraps all of `/admin/*`, so the guard mounts
// once and lives for the whole admin session.
export default function AdminGuard({ children }) {
  const location = useLocation();
  const [phase, setPhase] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          setPhase('unauthed');
          return;
        }
        const data = await res.json();
        setPhase(data?.authenticated ? 'authed' : 'unauthed');
      } catch {
        if (cancelled) return;
        // Treat a network failure as unauthed — the user can retry
        // from the login page. Better than letting them think they're
        // signed in when they aren't.
        setPhase('unauthed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        טוען…
      </div>
    );
  }

  if (phase === 'unauthed') {
    // Carry the originally requested URL through so the login page
    // can return us here on success. URLSearchParams handles the
    // encoding so a path with a query string doesn't get mangled.
    const returnTo = location.pathname + location.search + location.hash;
    const qs = new URLSearchParams({ returnTo }).toString();
    return <Navigate to={`/admin/login?${qs}`} replace />;
  }

  return children;
}
