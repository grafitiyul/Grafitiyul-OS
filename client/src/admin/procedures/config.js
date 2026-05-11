// Stable keys for the procedures module and its tabs.
// Logic and routing reference only `key` / `path`. Display labels are
// free to change without touching any other code.
export const MODULE_KEY = 'procedures';

// Visual order only — routes (`path`), permissions, and the
// /admin/procedures index redirect in App.jsx continue to use `flows`
// as the default landing. Reordering this array changes the visible
// order in the desktop ProceduresLayout header AND the mobile bottom
// tab bar; both iterate this list directly.
export const TABS = [
  { key: 'bank', path: 'bank', label: 'בנק פריטים', glyph: '☷' },
  { key: 'approvals', path: 'approvals', label: 'אישור תשובות', glyph: '✓' },
  { key: 'flows', path: 'flows', label: 'זרימות', glyph: '⇆' },
];

// Approvals views. `key` is stable, `label` is display-only.
export const APPROVAL_VIEWS = [
  { key: 'inbox', label: 'תיבת הנכנסות' },
  { key: 'by_flow', label: 'לפי זרימה' },
  { key: 'by_person', label: 'לפי אדם' },
];
