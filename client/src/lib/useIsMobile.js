import { useEffect, useState } from 'react';

// Viewport hook for BEHAVIOURAL mobile/desktop branches in the admin app
// (mounting a different component tree, not just restyling — for pure visuals
// prefer Tailwind responsive classes).
//
// Unlike public/hooks/useMediaQuery.js (SSR-safe: false on first render), the
// admin app is a client-only SPA — the state initialises SYNCHRONOUSLY from
// matchMedia so the first render already mounts the correct tree. This matters:
// a wrong first frame would mount heavy workspaces (TimelineFeed, ChatThread)
// twice and double their fetches.
//
// Default breakpoint = below Tailwind `lg` (1024px), matching the admin
// shell's existing desktop/mobile split (NavRail vs MobileTabBar).
export function useIsMobile(maxWidthPx = 1023) {
  const query = `(max-width: ${maxWidthPx}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

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
