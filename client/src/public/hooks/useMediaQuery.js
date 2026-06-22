import { useEffect, useState } from 'react';
import { breakpoints } from '../theme/tokens.js';

// SSR-safe media-query hook. Returns false on the server / first render (no
// `window`), then updates after mount — so it never throws during SSR and
// hydration stays stable. Use for behavioural differences only; prefer
// Tailwind responsive classes for purely visual layout.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Convenience: true when the viewport is at/above the desktop breakpoint.
// Mobile-first — components render the mobile composition by default and opt
// into the desktop one when this is true.
export function useIsDesktop() {
  return useMediaQuery(`(min-width: ${breakpoints.desktop}px)`);
}
