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

// Structural value equality for dirty comparison — primitives, arrays, and plain
// objects (deep). Enough for form buffers; not a general-purpose deepEqual (no
// Map/Set/Date handling, which forms here don't use).
export function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!valuesEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !valuesEqual(a[k], b[k])) return false;
  }
  return true;
}

// The ergonomic, revert-aware entry point. A form is dirty ONLY when its current
// editable values differ from the original baseline — so typing a change marks it
// dirty, and editing back to the original value clears it automatically. Pass the
// SAME baseline you initialised the buffer from; after a successful save or reload
// the baseline updates with the data, which clears the dirty state. When a surface
// is inactive (e.g. a closed dialog), pass active=false to force "clean".
//
//   useDirtyWhen(form, original);                 // page / section
//   useDirtyWhen(fields, EMPTY, { active: open }); // create dialog
export function useDirtyWhen(current, original, { active = true } = {}) {
  useDirtyForm(active && !valuesEqual(current, original));
}
