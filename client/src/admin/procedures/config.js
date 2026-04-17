// Stable keys for the procedures module and its tabs.
// Logic and routing reference only `key` / `path`. Display labels are
// free to change without touching any other code.
export const MODULE_KEY = 'procedures';

export const TABS = [
  { key: 'flows', path: 'flows', label: 'זרימות', glyph: '⇆' },
  { key: 'bank', path: 'bank', label: 'בנק פריטים', glyph: '☷' },
  { key: 'approvals', path: 'approvals', label: 'אישור תשובות', glyph: '✓' },
];

// Approvals views. `key` is stable, `label` is display-only.
export const APPROVAL_VIEWS = [
  { key: 'inbox', label: 'תיבת הנכנסות' },
  { key: 'by_flow', label: 'לפי זרימה' },
  { key: 'by_person', label: 'לפי אדם' },
];
