// Stable keys + Hebrew labels for the Deal module. Logic references keys.

export const DEAL_STATUSES = ['open', 'won', 'lost'];

// Business terms — kept in English (these are the labels the team uses).
export const DEAL_STATUS_LABELS = {
  open: 'OPEN',
  won: 'WON',
  lost: 'LOST',
};

export const DEAL_STATUS_STYLES = {
  open: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  won: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  lost: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
};

// Activity type — "סוג פעילות". Belongs to the Deal now and to the actual
// tour/activity later. Keys are stable; logic never reads the Hebrew label.
export const ACTIVITY_TYPES = ['group', 'private', 'business'];
export const ACTIVITY_TYPE_LABELS = {
  group: 'קבוצתי',
  private: 'פרטי',
  business: 'עסקי',
};

// DealContact roles — a contact may hold multiple. The first three are the
// operational quick-add vocabulary; the rest are the original roles, kept for
// backward compatibility with existing data. (Single hardcoded catalog for now;
// a future Settings-driven catalog can replace it — see VALID_ROLES in
// server/src/routes/deals.js, which must stay in sync.)
export const ROLE_ORDER = [
  'ongoingBooking',
  'fieldRep',
  'finance',
  'coordinator',
  'payer',
  'decisionMaker',
  'participant',
  'invoiceContact',
  'other',
];

export const ROLE_LABELS = {
  ongoingBooking: 'הזמנה שוטפת',
  fieldRep: 'נציג בשטח',
  finance: 'איש כספים',
  coordinator: 'מתאם',
  payer: 'משלם',
  decisionMaker: 'מקבל החלטות',
  participant: 'משתתף',
  invoiceContact: 'איש קשר לחשבונית',
  other: 'אחר',
};

// The compact role set offered in the Deal-header quick-add contact form.
export const QUICK_CONTACT_ROLES = ['ongoingBooking', 'fieldRep', 'finance'];

// Per-deal communication preferences (operational routing).
export const PREF_FIELDS = [
  { key: 'receiveConfirmations', label: 'אישורים' },
  { key: 'receiveOperationalUpdates', label: 'עדכונים תפעוליים' },
  { key: 'receivePaymentLinks', label: 'קישורי תשלום' },
  { key: 'receiveQuotes', label: 'הצעות מחיר' },
];

export function contactNameHe(c) {
  if (!c) return '';
  return `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
}
