// Collection (גבייה) status presentation — shared by the Deal panel and the
// Collection screen. The status VALUES come from the server Collection service
// (server/src/collection.js), never derived on the client.

export const COLLECTION_STATUS_LABELS = {
  no_amount: 'חסר סכום',
  unpaid: 'טרם שולם',
  partial: 'שולם חלקית',
  paid: 'שולם במלואו',
  overpaid: 'שולם ביתר',
  // The server refused to decide: the accounting evidence is contradictory or
  // ambiguous. The numbers are still shown — this says they are not trustworthy
  // until a human answers the question attached to the deal.
  review: 'דורש בדיקה',
};

export const COLLECTION_STATUS_STYLES = {
  no_amount: 'bg-gray-100 text-gray-500',
  unpaid: 'bg-red-50 text-red-600',
  partial: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-50 text-emerald-700',
  overpaid: 'bg-sky-50 text-sky-700',
  review: 'bg-purple-50 text-purple-700',
};

// How a single piece of evidence was established. The distinction is a product
// requirement, not decoration: an operator must never mistake money they typed
// in for money an accounting document proves.
export const EVIDENCE_CLASS_BADGE = {
  verified: { label: 'מאומת באייקאונט', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  provider: { label: 'סליקה אוטומטית', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  manual: { label: 'נרשם ידנית', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
};
