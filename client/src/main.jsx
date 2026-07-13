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

// ── PRE-MOUNT: purge the legacy device-global portal token ───────
//
// SECURITY (incident 2026-07-13): earlier builds persisted any visited
// guide token into localStorage['gos.portalToken'] and the root/launch
// resolver read it back — so a device that had opened ONE guide's portal
// would re-open that portal from the bare domain (and an installed PWA
// launching at /launch would drop into it). Portal identity must be
// URL-token scoped, never device-global.
//
// We now remove the key on EVERY load, so already-affected devices
// self-heal on their next visit without any manual cache clearing.
// (sessionStorage is tab-scoped and only powers the same-tab
// attempt→portal "back" button; it never feeds root routing, so we
// leave it untouched.)
(function purgeLegacyDevicePortalToken() {
  try {
    localStorage.removeItem('gos.portalToken');
  } catch {
    /* private mode / storage disabled — nothing to purge */
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
