// Stable keys + Hebrew labels for the Deal module. Logic references keys.

export const DEAL_STATUSES = ['open', 'won', 'lost'];

export const DEAL_STATUS_LABELS = {
  open: 'פתוח',
  won: 'נסגר בהצלחה',
  lost: 'אבוד',
};

export const DEAL_STATUS_STYLES = {
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  won: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  lost: 'bg-gray-100 text-gray-600 border-gray-200',
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
