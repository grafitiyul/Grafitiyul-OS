// Pure selection semantics behind the shared MultiSelectFilter — no React,
// unit-testable with node --test (tableColumnsCore.js convention).
//
// The ONE convention for every multi-select filter surface:
//   • values = the explicitly checked option values.
//   • [] (nothing checked) OR every option checked ⇒ UNRESTRICTED — consumers
//     apply no filtering.
//
// Canonical stored form (the general-additions incident, 2026-07): an
// EXHAUSTIVE selection is the same state as unrestricted, so it must be
// STORED as []. Persisting the full value list instead ("all 2 guides
// checked") silently becomes a restrictive filter the moment the option set
// grows (new payroll people appear) — hiding exactly the new rows while the
// old ones keep rendering. collapseSelection() is applied on every write.

export function isUnrestricted(values, options) {
  return values.length === 0 || values.length >= options.length;
}

// Collapse an exhaustive selection to the canonical unrestricted form ([]).
// Coverage is checked value-by-value (never by length alone — saved values
// may contain stale ids that no longer exist as options).
export function collapseSelection(values, options) {
  if (options.length === 0 || values.length === 0) return values;
  const set = new Set(values);
  return options.every((o) => set.has(o.value)) ? [] : values;
}

// Toggle one option value and return the canonical stored form.
export function toggleValue(values, options, value) {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return collapseSelection([...next], options);
}
