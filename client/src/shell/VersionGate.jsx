import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribeVersion, getVersionState, safeToReload } from '../lib/version.js';

// The React surface of the version channel (lib/version.js). Two jobs:
//
//   1. Auto-reload at a SAFE moment. When a newer build is live and the user
//      navigates to a different route (a deliberate, not-mid-typing moment), we
//      reload onto the fresh build — unless a form is dirty or an input is
//      focused, in which case we leave the toast up for a manual refresh.
//   2. Show a non-blocking "גרסה חדשה זמינה" toast with a Refresh button as the
//      always-available manual path.
//
// Mount once, inside the Router (it uses useLocation). It renders nothing until
// an update is actually pending.
export default function VersionGate() {
  const [state, setState] = useState(getVersionState);
  const location = useLocation();
  const firstNav = useRef(true);

  useEffect(() => subscribeVersion(() => setState(getVersionState())), []);

  // Reload on route change when an update is pending and it's safe to do so.
  // We key on pathname only: we explicitly do NOT reload the instant an update
  // is detected — we wait for the user to move to a new screen.
  useEffect(() => {
    if (firstNav.current) {
      firstNav.current = false;
      return;
    }
    if (state.updatePending && safeToReload()) {
      // The client route already changed to the target URL; a full reload now
      // loads the new build at that destination.
      window.location.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!state.updatePending) return null;

  return (
    <div
      dir="rtl"
      role="status"
      className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg"
    >
      <span>גרסה חדשה זמינה</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-blue-600 px-3 py-1 text-[13px] font-semibold hover:bg-blue-700"
      >
        רענון
      </button>
    </div>
  );
}
