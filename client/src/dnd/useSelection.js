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
// click so the range selection uses the current visible ordering. This
// keeps the hook itself stateless about the rendered list — works equally
// well for a flat bank list and for a flattened flow tree.
//
// The drag-set resolver (`dragSetFor`) answers: "when the user starts
// dragging id X, which ids should move together?" Standard rule:
// if X is selected → drag all selected; else → drag just X (and don't
// mutate selection). This matches file-manager conventions.
export function useSelection() {
  const [selected, setSelected] = useState(() => new Set());
  const anchorRef = useRef(null);

  const isSelected = useCallback((id) => selected.has(id), [selected]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
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
      // Anchor no longer in list — fall through to treat as a plain
      // click that establishes a new anchor.
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

  // Called by the DnD layer at drag-start. Does NOT mutate selection —
  // dragging a non-selected item is common enough (file managers) that
  // we shouldn't change the current selection on drag pickup.
  const dragSetFor = useCallback(
    (id) => (selected.has(id) ? new Set(selected) : new Set([id])),
    [selected],
  );

  return useMemo(
    () => ({
      selected,
      isSelected,
      clear,
      toggle,
      handleClick,
      dragSetFor,
      size: selected.size,
    }),
    [selected, isSelected, clear, toggle, handleClick, dragSetFor],
  );
}
