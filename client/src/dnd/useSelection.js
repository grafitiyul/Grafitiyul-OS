import { useCallback, useMemo, useRef, useState } from 'react';

// Generic multi-select hook for list/tree UIs.
//
// Supports:
//   * plain click         → single-select (replace)
//   * Ctrl/Cmd + click    → toggle membership
//   * Shift + click       → range from last anchor to clicked id
//   * checkbox toggle     → same as Ctrl+click (explicit multi-select path)
//
// The caller passes `orderedIds` (in display order) at the moment of each
// click so range selection uses the current visible ordering. This keeps
// the hook stateless about the rendered list — works equally well for a
// flat bank list and for a flattened flow tree.
//
// The hook deliberately does NOT provide a "dragSetFor" helper. Drag-set
// resolution belongs at the call site where drag starts: it should
// snapshot the live `selected` set directly, not read it through a
// closure. That avoids a class of off-by-one bugs where a stale
// `selected` captured by a `useCallback` closure leaks extra ids into
// the drag set.
export function useSelection() {
  const [selected, setSelected] = useState(() => new Set());
  const anchorRef = useRef(null);

  const isSelected = useCallback((id) => selected.has(id), [selected]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  // Bulk replace — useful when the consumer wants to wipe selection on a
  // context change (e.g. entering a different folder) without triggering
  // anchor drift.
  const replace = useCallback((ids) => {
    setSelected(new Set(ids || []));
    anchorRef.current = ids && ids.length ? ids[ids.length - 1] : null;
  }, []);

  const handleClick = useCallback((id, modifiers, orderedIds) => {
    const ctrl = !!(modifiers && (modifiers.ctrl || modifiers.meta));
    const shift = !!(modifiers && modifiers.shift);

    if (shift && anchorRef.current != null && orderedIds) {
      const a = orderedIds.indexOf(anchorRef.current);
      const b = orderedIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelected(new Set(orderedIds.slice(lo, hi + 1)));
        return;
      }
      // Anchor no longer in list — fall through to plain-click behavior.
    }

    if (ctrl) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
      return;
    }

    // Plain click: replace.
    setSelected(new Set([id]));
    anchorRef.current = id;
  }, []);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  return useMemo(
    () => ({
      selected,
      isSelected,
      clear,
      replace,
      toggle,
      handleClick,
      size: selected.size,
    }),
    [selected, isSelected, clear, replace, toggle, handleClick],
  );
}
