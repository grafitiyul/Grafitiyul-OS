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

// The SINGLE source of truth for the activity-badge text — used by both the
// Deal header (ActivityBadge) and the WhatsApp inbox row badge, so they can
// never diverge. For a business deal it shows the SPECIFIC classification (the
// effective org-type + subtype labels), falling back to the broad "עסקי" only
// when no specific type exists. `orgTypeLabel` is the deal's own org-type
// label OR the linked organization's default; `subtypeLabel` is the subtype's.
// Returns null when no activity type is set (callers supply their own affordance).
export function resolveActivityLabel({ activityType, orgTypeLabel, subtypeLabel } = {}) {
  if (!activityType) return null;
  if (activityType === 'private') return ACTIVITY_TYPE_LABELS.private;
  if (activityType === 'group') return ACTIVITY_TYPE_LABELS.group;
  return [orgTypeLabel, subtypeLabel].filter(Boolean).join(' ') || ACTIVITY_TYPE_LABELS.business;
}

// Finance workspace routing — which pricing workspace a Deal opens when the user
// clicks "מחיר". Kept in ONE place so the rule is swappable: today it maps from
// activityType, but the intended future model is a CRM setting
// (ActivityType → Finance Workspace). Consumers must call resolveFinanceWorkspace()
// and NEVER scatter `activityType === 'group'` checks across components.
export const FINANCE_WORKSPACE = {
  PRICE_BUILDER: 'price_builder', // Business Price Builder (free rows)
  TICKET_BUILDER: 'ticket_builder', // Group Ticket Builder (ticket-type sales)
};

// TEMP mapping (the only place that reads activityType for routing). Replace the
// body with a CRM-setting lookup when "Activity Type → Finance Workspace" ships;
// the call sites stay unchanged.
export function resolveFinanceWorkspace(deal) {
  return deal?.activityType === 'group'
    ? FINANCE_WORKSPACE.TICKET_BUILDER
    : FINANCE_WORKSPACE.PRICE_BUILDER;
}

// DealContact roles — a contact may hold multiple. The first three are the
// operational quick-add vocabulary; the rest are the original roles, kept for
// backward compatibility with existing data. (Single hardcoded catalog for now;
// a future Settings-driven catalog can replace it — see VALID_ROLES in
// server/src/routes/deals.js, which must stay in sync.)
export const ROLE_ORDER = [
  'ongoingBooking',
  'fieldRep',
  'finance',
  'endClient',
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
  endClient: 'לקוח הקצה',
  coordinator: 'מתאם',
  payer: 'משלם',
  decisionMaker: 'מקבל החלטות',
  participant: 'משתתף',
  invoiceContact: 'איש קשר לחשבונית',
  other: 'אחר',
};

// The compact role set offered in the Deal-header quick-add contact form.
export const QUICK_CONTACT_ROLES = ['ongoingBooking', 'fieldRep', 'finance', 'endClient'];

// Per-deal communication preferences (operational routing).
export const PREF_FIELDS = [
  { key: 'receiveConfirmations', label: 'אישורים' },
  { key: 'receiveOperationalUpdates', label: 'עדכונים תפעוליים' },
  { key: 'receivePaymentLinks', label: 'קישורי תשלום' },
  { key: 'receiveQuotes', label: 'הצעות מחיר' },
];

// "פרטי הסיור" working-field catalogs. Keys are stable; labels are display-only.
// Mirror the API validators in server/src/routes/deals.js (VALID_PAYMENT_METHODS
// / VALID_COMM_LANGS / VALID_TOUR_LANGS).
export const PAYMENT_METHODS = [
  { key: 'card', label: 'כרטיס אשראי' },
  { key: 'transfer', label: 'העברה בנקאית' },
  { key: 'cash', label: 'מזומן' },
  { key: 'check', label: "צ'ק" },
  { key: 'other', label: 'אחר' },
];

export const COMM_LANGS = [
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'אנגלית' },
];

export const TOUR_LANGS = [
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'אנגלית' },
  { key: 'es', label: 'ספרדית' },
  { key: 'fr', label: 'צרפתית' },
  { key: 'ru', label: 'רוסית' },
];

export function contactNameHe(c) {
  if (!c) return '';
  return `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
}
