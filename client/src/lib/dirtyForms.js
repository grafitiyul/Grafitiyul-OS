import { useEffect, useRef } from 'react';

// A tiny, framework-agnostic registry of "there are unsaved changes right now".
// The version auto-reload (see lib/version.js safeToReload) consults it so a new
// deployment NEVER reloads a tab out from under a half-typed form. Any GOS form
// can opt in via the useDirtyForm hook; surfaces that don't opt in still benefit
// from the focused-input guard in safeToReload().

const dirty = new Set();

export function markDirty(id) {
  dirty.add(id);
}
export function clearDirty(id) {
  dirty.delete(id);
}
export function hasDirtyForms() {
  return dirty.size > 0;
}

let seq = 0;

// Register a form's dirty state. Pass `true` while it holds unsaved edits, `false`
// once saved/clean. Automatically unregisters on unmount.
//
//   const [dirty, setDirty] = useState(false);
//   useDirtyForm(dirty);
export function useDirtyForm(isDirty) {
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = `f${++seq}`;
  useEffect(() => {
    const id = idRef.current;
    if (isDirty) markDirty(id);
    else clearDirty(id);
    return () => clearDirty(id);
  }, [isDirty]);
}
