import { staffColorHex } from '../../../shared/staffColors.mjs';

// Shared presentation helpers derived from the canonical staff color — every
// tinted surface (staff rows, tour rows/cards) goes through here so the
// "subtle tint + strong edge stripe" recipe can never fork per screen.

// Very light row tint (~6% alpha) + a narrow saturated inline-start stripe.
// Inline style (not Tailwind) because the hex is data-driven; alpha keeps
// text/chips/inputs fully readable. Returns {} for no color → neutral row.
export function rowTintStyle(colorKey) {
  const hex = staffColorHex(colorKey);
  if (!hex) return {};
  return {
    backgroundColor: `${hex}10`,
    // Negative X = the RIGHT edge — the inline-start side in RTL.
    boxShadow: `inset -3px 0 0 0 ${hex}`,
  };
}

// Card/list accent — a saturated inline-start edge only (no background), for
// compact tour cards where content density is high.
export function edgeAccentStyle(colorKey) {
  const hex = staffColorHex(colorKey);
  if (!hex) return {};
  return { boxShadow: `inset -3px 0 0 0 ${hex}` };
}
