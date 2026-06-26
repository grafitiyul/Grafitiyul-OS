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

// DealContact roles — a contact may hold multiple.
export const ROLE_ORDER = [
  'coordinator',
  'payer',
  'decisionMaker',
  'participant',
  'invoiceContact',
  'other',
];

export const ROLE_LABELS = {
  coordinator: 'מתאם',
  payer: 'משלם',
  decisionMaker: 'מקבל החלטות',
  participant: 'משתתף',
  invoiceContact: 'איש קשר לחשבונית',
  other: 'אחר',
};

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
