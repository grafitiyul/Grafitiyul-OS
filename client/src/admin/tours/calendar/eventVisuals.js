import {
  staffColorHex,
  foregroundForHex,
  mixHexWithWhite,
} from '../../../../../shared/staffColors.mjs';
import { TOUR_STATUS_EVENT_STYLES } from '../config.js';

// Calendar event visuals — the CALENDAR-specific intensity of the canonical
// guide color (full saturated background, Airtable-style), layered with the
// shared status vocabulary. This is deliberately STRONGER than the table's
// rowTintStyle (staffColorUi.js) — many tours are compared at once on the
// calendar, so full color is operationally useful there and only there.
//
// Layering rule (product decision):
//   * cancelled / postponed → the STATUS style stays fully dominant (red /
//     amber classes) regardless of any guide identity. Postponed tours have
//     no date and shouldn't reach the grid at all — this is defense.
//   * scheduled + guide color        → full guide color, auto black/white text.
//   * scheduled + unassigned         → BLACK event, white text ("no relevant
//     guide" must be instantly visible; assistant-only counts as unassigned).
//   * scheduled + neutral            → the existing default event style
//     (multiple guides without a lead is NOT an error state — never black).
//   * completed → same identity, muted: the color is mixed toward white so
//     the guide stays recognizable without shouting, plus the status label
//     the views already render. Text contrast is recomputed on the mix.
//
// Pure module (no React/DOM) — unit-tested with node --test.

// "Unassigned = black": near-black (gray-900), clearly distinct from the
// cancelled red treatment and from every palette color.
const UNASSIGNED_HEX = '#111827';

// Completed events keep ~45% of the identity color.
const COMPLETED_WHITE_MIX = 0.55;

// Solid full-color pill — foreground is data-driven, borders off (the color
// itself separates events; a small gap between pills does the rest).
function solid(hex) {
  const fg = foregroundForHex(hex);
  return {
    cls: 'border-transparent hover:brightness-95',
    style: { backgroundColor: hex, color: fg },
    fg,
  };
}

export function calendarEventVisual(ev) {
  const status = ev?.status || 'scheduled';
  if (status === 'cancelled' || status === 'postponed') {
    return {
      cls: TOUR_STATUS_EVENT_STYLES[status],
      style: undefined,
      fg: null,
    };
  }
  // Server-derived semantics; older payload without `guideColorSource`
  // degrades safely: color → guide, no color → neutral (NEVER silently black).
  const source = ev?.guideColorSource || (ev?.guideColor ? 'guide' : 'neutral');
  const hex =
    source === 'unassigned' ? UNASSIGNED_HEX : staffColorHex(ev?.guideColor);
  if (!hex) {
    // neutral (multi-guide without a lead / guide without a color) — the
    // canonical default event look, same as before.
    return {
      cls: TOUR_STATUS_EVENT_STYLES[status] || TOUR_STATUS_EVENT_STYLES.scheduled,
      style: undefined,
      fg: null,
    };
  }
  if (status === 'completed') {
    return solid(mixHexWithWhite(hex, COMPLETED_WHITE_MIX));
  }
  return solid(hex);
}

// Compact "לא משובץ" flag — only for scheduled tours with no relevant guide
// (black events must be explainable at a glance, and must not read as
// cancelled).
export function isUnassignedScheduled(ev) {
  return (ev?.status || 'scheduled') === 'scheduled' && ev?.guideColorSource === 'unassigned';
}
