// Stable keys + display labels for the CRM module. Logic references keys,
// never the Hebrew labels.
//
// CRM is the operational hub of GOS.
//
// משימות (Tasks) is the PRIMARY tab and the CRM landing route: it is the screen
// the owner works in all day — filter to a time window, work the rows, open a
// Deal only when the row itself cannot answer the question. Deals, Contacts and
// Organizations are what you reach FROM that work. Configuration (types,
// subtypes, deal stages) lives under the global Settings module, not here.
//
// (This header used to contradict itself: it called CRM a "SECONDARY reference
// surface" and an "interim home until Activities exist", while the list below
// already treated CRM as the hub. The Tasks workspace is what "Activities" was
// waiting for, so the stale half is gone.)
export const CRM_TABS = [
  { key: 'tasks', path: 'tasks', label: 'משימות' },
  { key: 'deals', path: 'deals', label: 'דילים' },
  { key: 'contacts', path: 'contacts', label: 'אנשי קשר' },
  { key: 'organizations', path: 'organizations', label: 'ארגונים' },
];
