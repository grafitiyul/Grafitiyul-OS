import { createContext, useContext } from 'react';

// THE application floating layer — one context, one z-index band, no per-screen
// duplication. Every floating surface (AnchoredMenu, SearchSelect, and any
// Dialog opened from inside one) reads its nesting depth from here instead of
// hardcoding a z-index and hoping.
//
// A floating surface does two things:
//   1. consumes useFloatingDepth() to place ITSELF, and
//   2. wraps its children in <FloatingLayer depth={depth}> so anything opened
//      FROM it is one level up.
//
// The numbers live in the pure, unit-tested floatingLayerCore.js.
//
// Rule for new code: a dropdown / combobox / menu / picker NEVER positions
// itself with `absolute` inside its parent. It renders through AnchoredMenu
// (or SearchSelect for the searchable-async case). An `absolute` panel is
// clipped by any ancestor with overflow — and no z-index can rescue it,
// because overflow clipping is not a stacking concern.

export * from './floatingLayerCore.js';

const FloatingDepthContext = createContext(0);

// How deep the current subtree sits in the floating stack. 0 = rendered by the
// page itself; 1 = rendered inside one floating surface; and so on.
export function useFloatingDepth() {
  return useContext(FloatingDepthContext);
}

// Wraps the CONTENT of a floating surface that renders at `depth`, so anything
// that surface opens knows it must stack above it.
export function FloatingLayer({ depth, children }) {
  return (
    <FloatingDepthContext.Provider value={depth + 1}>{children}</FloatingDepthContext.Provider>
  );
}
