import { Navigate } from 'react-router-dom';

// Root-route resolver. The bare `/` URL has two callers:
//
//   * Admins typing the bare domain or installing the PWA from inside
//     /admin/* — they expect to land in the admin shell.
//   * Guides who installed the PWA from /p/:token — the manifest's
//     start_url is `/`, so re-launching the installed app drops them
//     here instead of their portal. Without smart routing, they bounce
//     to /admin and hit the login screen, which is the bug we're
//     fixing: a guide should never see admin login.
//
// Resolution order:
//   1. localStorage `gos.portalToken` — set by GuidePortal on every
//      visit. Persistent across PWA launches (sessionStorage isn't —
//      a relaunched PWA is a fresh tab).
//   2. Otherwise, send to /admin (which is itself behind AdminGuard,
//      so unauthenticated admins still get the login experience they
//      should).
//
// Render-time decision (Navigate component) keeps the user from ever
// seeing a flash of the wrong shell.
export default function Landing() {
  let portalToken = null;
  try {
    portalToken = localStorage.getItem('gos.portalToken') || null;
  } catch {
    /* private mode / disabled storage — fall through to /admin */
  }
  if (portalToken && /^[A-Za-z0-9_-]+$/.test(portalToken)) {
    return <Navigate to={`/p/${encodeURIComponent(portalToken)}`} replace />;
  }
  return <Navigate to="/admin" replace />;
}
