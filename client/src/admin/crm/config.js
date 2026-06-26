// Stable keys + display labels for the CRM module. Logic references keys,
// never the Hebrew labels.
//
// CRM is a SECONDARY reference/management surface — not a daily working screen.
// Daily work will start from Activities (built later); from an Activity you open
// a Deal, and from a Deal you reach these Contacts and Organizations. Until
// Activities/Deals exist, this module is the interim home for the foundation
// reference data.

export const CRM_TABS = [
  { key: 'organizations', path: '', label: 'ארגונים' },
  { key: 'contacts', path: 'contacts', label: 'אנשי קשר' },
  { key: 'settings', path: 'settings', label: 'הגדרות' },
];
