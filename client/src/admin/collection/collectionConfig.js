// Collection (גבייה) status presentation — shared by the Deal card and the
// Collection screen. The status VALUES come from the server Collection
// service (server/src/collection.js), never derived on the client.

export const COLLECTION_STATUS_LABELS = {
  no_amount: 'חסר סכום',
  unpaid: 'טרם שולם',
  partial: 'שולם חלקית',
  paid: 'שולם במלואו',
};

export const COLLECTION_STATUS_STYLES = {
  no_amount: 'bg-gray-100 text-gray-500',
  unpaid: 'bg-red-50 text-red-600',
  partial: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-50 text-emerald-700',
};
