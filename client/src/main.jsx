import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './shell/ErrorBoundary.jsx';
import { installChunkReload } from './lib/chunkReload.js';
import { startVersionWatch } from './lib/version.js';
import './index.css';

// Frontend delivery resilience (no service worker, no header changes):
//   • installChunkReload — one-time guarded reload if a future lazy chunk 404s
//     against a stale tab after a deploy. Installed first, before any import().
//   • startVersionWatch  — polls /version.json so an open tab learns when a new
//     frontend is deployed and can update at a safe moment (see VersionGate).
installChunkReload();
startVersionWatch();

// ── PRE-MOUNT: persist portal token from URL ─────────────────────
//
// We persist any guide-portal token visible in the current URL into
// localStorage at module-load time, BEFORE React mounts. This makes
// the persistence resilient to:
//   * The user closing the tab/PWA before GuidePortal's useEffect
//     fires (rare but possible on slow first paint).
//   * Future routing changes that might unmount GuidePortal during
//     init.
//   * Any code-splitting that delays GuidePortal's own bundle.
//
// The token is what powers the smart Landing (/ and /launch): if a
// guide ever visited /p/:token in this PWA / origin context, future
// PWA launches at start_url should bounce them back to /p/<token>
// instead of dropping them on /admin/login.
//
// Three URL shapes we accept:
//   /p/:token                     — the canonical portal entry.
//   /attempt/:id?p=<token>        — runtime hand-off.
//   /(launch)?p=<token>           — explicit launcher hand-off, used
//                                    when sharing a link that should
//                                    open the PWA in portal mode.
(function persistPortalTokenFromUrl() {
  try {
    const path = window.location.pathname || '';
    const search = window.location.search || '';
    // Match any token-bearing path shape we use:
    //   /p/<token>
    //   /launch/<token>
    //   /install-guide/<token>
    const pathMatch = path.match(
      /^\/(?:p|launch|install-guide)\/([^/?#]+)/,
    );
    let token = null;
    if (pathMatch && pathMatch[1]) {
      try {
        token = decodeURIComponent(pathMatch[1]);
      } catch {
        token = pathMatch[1];
      }
    } else {
      const params = new URLSearchParams(search);
      const p = params.get('p');
      if (p) token = p;
    }
    if (token && /^[A-Za-z0-9_-]+$/.test(token)) {
      localStorage.setItem('gos.portalToken', token);
    }
  } catch {
    /* private mode / storage disabled — fall back to in-component
       writes in GuidePortal. Best-effort only. */
  }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
