// Stable keys + display labels for the כספים (Finance) module. Logic
// references keys, never the Hebrew labels.
//
// Finance is the money hub with three areas:
//   - collection (גבייה מלקוחות) — the existing Collection module, unchanged
//     besides its navigation home.
//   - payroll (שכר צוות) — staff payroll entries (built in slices).
//   - management (ניהול פיננסי) — placeholder for the future finance area.
export const FINANCE_TABS = [
  { key: 'collection', path: 'collection', label: 'גבייה מלקוחות' },
  { key: 'payroll', path: 'payroll', label: 'שכר צוות' },
  { key: 'management', path: 'management', label: 'ניהול פיננסי' },
];
