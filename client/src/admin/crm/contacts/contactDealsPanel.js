// Pure presentation logic for the Contact page's "דילים קודמים" panel — kept
// as plain JS so the rules are testable with the node test runner.

// Compact initial set — the panel must never grow excessively tall; beyond
// this the section offers "הצג הכל".
export const INITIAL_ROWS = 5;

export const EMPTY_STATE_TEXT = 'אין דילים קודמים לאיש קשר זה';

// Whole-row status treatment (soft backgrounds, accessible contrast). The
// status is NEVER color-only — every row also renders the canonical
// DEAL_STATUS_LABELS badge (deals/config.js) as text.
//   open → light blue, won → soft green, lost → soft red.
export const DEAL_ROW_TONE = {
  open: 'border-blue-200 bg-blue-50/70 hover:bg-blue-100/60',
  won: 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/60',
  lost: 'border-red-200 bg-red-50/70 hover:bg-red-100/60',
};
export const DEAL_ROW_TONE_FALLBACK = 'border-gray-200 bg-gray-50 hover:bg-gray-100';

export function dealRowTone(status) {
  return DEAL_ROW_TONE[status] || DEAL_ROW_TONE_FALLBACK;
}

// The rows to render: everything when expanded (or small), else the compact
// initial set. Server order (canonical activity-desc) is preserved as-is.
export function visibleDeals(deals, showAll, limit = INITIAL_ROWS) {
  const list = Array.isArray(deals) ? deals : [];
  return showAll || list.length <= limit ? list : list.slice(0, limit);
}
