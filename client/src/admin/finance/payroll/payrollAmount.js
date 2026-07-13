import { toMinor } from '../../../lib/money.js';

// The ONE place the editable-amount rules live, so the single-entry modal and
// the activity matrix behave identically (calculated / override / final stay
// separate on the server; only the UI is unified to one editable field).
//
// Editing one amount field resolves to the override to persist:
//   empty              → clear the override (return to the calculated value)
//   "0"                → explicit zero override (final = 0, NOT the calculated)
//   = the calculated   → clear the override (never store a redundant override)
//   any other number   → override to that value
//
// Returns { noop: true } when nothing should change (invalid input, or the
// value already matches the stored state), otherwise { overrideMinor }.
export function resolveAmountEdit(raw, line) {
  const trimmed = String(raw ?? '').trim();
  const calc = line.calculatedMinor == null ? null : Number(line.calculatedMinor);
  const cur = line.overrideMinor == null ? null : Number(line.overrideMinor);
  let next;
  if (trimmed === '') {
    next = null; // clear override → calculated
  } else {
    const parsed = toMinor(trimmed);
    if (parsed == null) return { noop: true }; // invalid → ignore
    next = parsed === calc ? null : parsed; // typing the calculated value clears the override
  }
  if (next === cur) return { noop: true };
  return { overrideMinor: next };
}

// Final (payable) value of a line: override wins, else calculated, else 0.
export function lineFinalMinor(line) {
  if (line.overrideMinor != null) return Number(line.overrideMinor);
  if (line.calculatedMinor != null) return Number(line.calculatedMinor);
  return 0;
}

// Is this line an active override that differs from the calculation?
export function isOverridden(line) {
  return line.overrideMinor != null && Number(line.overrideMinor) !== Number(line.calculatedMinor);
}
