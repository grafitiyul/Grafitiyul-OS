import { useCallback, useEffect, useState } from 'react';

// Fetch a guide tours feed (upcoming | past) with the portal's resilience
// conventions: loud initial load, silent refresh on poll/focus (so scroll
// position survives), and last-good-data retention on transient failures —
// the "poor connection" behavior the portal promises.

export default function useToursFeed(token, scope) {
  const [state, setState] = useState({ phase: 'loading', tours: null });

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setState((p) => ({ ...p, phase: 'loading' }));
      try {
        const res = await fetch(
          `/api/portal/${encodeURIComponent(token)}/tours/${scope}`,
          { cache: 'no-store' },
        );
        if (res.status === 403) return setState({ phase: 'forbidden', tours: null });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setState({ phase: 'ready', tours: data.tours || [] });
      } catch (e) {
        setState((prev) =>
          silent && prev.tours
            ? prev // keep showing last good data; next poll retries
            : { phase: 'error', tours: null, message: e?.message || 'שגיאה' },
        );
      }
    },
    [token, scope],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => load({ silent: true }), 60000);
    const onVis = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [load]);

  return { ...state, reload: load };
}
