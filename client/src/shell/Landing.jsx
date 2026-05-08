import { Navigate, useSearchParams } from 'react-router-dom';

// Root-route resolver. Mounted on both `/` and `/launch` (the
// manifest's start_url). The PWA spec captures `start_url` at install
// time and reuses it for every subsequent launch, so this component
// is the FIRST thing a launched PWA renders.
//
// Two callers:
//
//   * Admins typing the bare domain or installing the PWA from inside
//     /admin/* — they expect to land in the admin shell.
//   * Guides who installed the PWA from /p/:token — start_url=/launch
//     drops them here and they expect to be back in their portal.
//
// Resolution order (most authoritative first):
//
//   1. URL `?p=<token>` query param. Lets a single URL like
//      `/launch?p=<token>` open the PWA directly into portal mode,
//      regardless of what's in storage. Saved to localStorage on
//      the way through so future bare /launch hits remember.
//   2. localStorage `gos.portalToken` — set by the pre-mount block
//      in main.jsx whenever the user visits any portal URL, by
//      GuidePortal's mount effect, and by step 1 above.
//   3. Otherwise, send to /admin (AdminGuard handles the rest).
//
// Render-time decision (Navigate component) keeps the user from ever
// seeing a flash of the wrong shell. localStorage.setItem is
// synchronous, so the redirect target sees a consistent value.
export default function Landing() {
  const [searchParams] = useSearchParams();
  let token = null;

  const fromQuery = searchParams.get('p');
  if (fromQuery && /^[A-Za-z0-9_-]+$/.test(fromQuery)) {
    token = fromQuery;
    try {
      localStorage.setItem('gos.portalToken', token);
    } catch {
      /* ignore */
    }
  }

  if (!token) {
    try {
      const stored = localStorage.getItem('gos.portalToken');
      if (stored && /^[A-Za-z0-9_-]+$/.test(stored)) {
        token = stored;
      }
    } catch {
      /* ignore */
    }
  }

  if (token) {
    return <Navigate to={`/p/${encodeURIComponent(token)}`} replace />;
  }
  return <Navigate to="/admin" replace />;
}
