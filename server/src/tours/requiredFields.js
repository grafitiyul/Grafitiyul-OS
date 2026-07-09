// Declarative required-field configuration for the Tours module.
//
// PRODUCT DECISION: validation lists are data, not code — no handler may
// hardcode its own required-field checks. Every gate (WON transition, group
// slot creation) reads one of the lists below and reports what is missing as
// [{ field, labelHe }], which the client renders verbatim as a checklist.

export const TOUR_EVENT_KINDS = ['private', 'business', 'group_slot'];
export const TOUR_EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'];
// Same vocabulary as Deal.tourLanguage (deals.js VALID_TOUR_LANGS) — the two
// fields sync at WON, so the value space must be identical.
export const TOUR_LANGS = ['he', 'en', 'es', 'fr', 'ru'];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // "YYYY-MM-DD" (Deal.tourDate convention)
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM" (Deal.tourTime convention)

// Hebrew labels for every gated field (shared by all lists; client renders
// these directly in missing-field checklists).
export const FIELD_LABELS_HE = {
  activityType: 'סוג פעילות',
  productId: 'מוצר',
  productVariantId: 'וריאציה',
  locationId: 'עיר / מיקום',
  tourDate: 'תאריך',
  tourTime: 'שעה',
  participants: 'משתתפים',
  tourLanguage: 'שפת סיור',
  date: 'תאריך',
  startTime: 'שעה',
  capacity: 'קיבולת',
};

// WON gate, per Deal.activityType. Private/business deals must be fully
// specified before WON (no draft tours — WON is refused otherwise). Group
// deals only need the deal-side minimum; the rest comes from the chosen slot.
export const WON_REQUIRED_FIELDS = {
  private: [
    'activityType',
    'productId',
    'productVariantId',
    'locationId',
    'tourDate',
    'tourTime',
    'participants',
    'tourLanguage',
  ],
  business: [
    'activityType',
    'productId',
    'productVariantId',
    'locationId',
    'tourDate',
    'tourTime',
    'participants',
    'tourLanguage',
  ],
  group: ['activityType', 'participants'],
};

// Group Tour Slot creation (Tours screen / inline at WON). Product decision:
// workshop location and participants are NOT required for a slot — the slot's
// city derives from the chosen variant.
export const GROUP_SLOT_REQUIRED_FIELDS = [
  'productId',
  'productVariantId',
  'date',
  'startTime',
  'tourLanguage',
  'capacity',
];

// Positive-integer fields get a stronger emptiness test than "non-blank".
const POSITIVE_INT_FIELDS = new Set(['participants', 'capacity']);

// Evaluate `fields` against `source` (a Deal row or a request body). Returns
// the missing subset as [{ field, labelHe }] — empty array means the gate is
// satisfied.
export function missingFields(source, fields) {
  const missing = [];
  for (const f of fields) {
    const v = source?.[f];
    const isMissing = POSITIVE_INT_FIELDS.has(f)
      ? !(Number.isInteger(Number(v)) && Number(v) >= 1)
      : v === undefined || v === null || String(v).trim() === '';
    if (isMissing) missing.push({ field: f, labelHe: FIELD_LABELS_HE[f] || f });
  }
  return missing;
}
