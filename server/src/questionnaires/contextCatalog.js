// The ALLOWLISTED catalog of read-only context fields a coordination form may
// show above its questions.
//
// ── Why a catalog and not variables ──────────────────────────────────────────
// The Communication Center's variable registry resolves against a MESSAGE
// context (a deal, a tour, a contact). This resolves against ONE BOOKING, which
// is a narrower and stricter thing: a coordination form must show that
// booking's customer and nobody else's, even when four unrelated bookings share
// an open tour. Reusing the message variables would have meant passing a
// deal-shaped context and hoping the right customer came out.
//
// ── What this is NOT ─────────────────────────────────────────────────────────
// Not questionnaire content. These values are never answers, never stored on
// the version, never editable as text. The operator picks WHICH canonical field
// appears and what it is LABELLED — never what it says.
//
// Not a query builder. Every field is a function over one already-loaded
// booking graph. There is no field the operator can define, so there is no
// shape of request that can reach data this file did not already fetch.
//
// Adding a field = one entry here. The picker, the renderer, the snapshot and
// the API all read this list.

import { formatDateHe } from '../communication/format.js';
import { staffName } from '../../../shared/staffName.mjs';
import { GENERIC_ACTIVITY_EN, GENERIC_ACTIVITY_HE } from '../displayFallbacks.js';

const TOUR_LANG_LABELS = {
  he: { he: 'עברית', en: 'אנגלית', ru: 'רוסית', fr: 'צרפתית', es: 'ספרדית', ar: 'ערבית' },
  en: { he: 'Hebrew', en: 'English', ru: 'Russian', fr: 'French', es: 'Spanish', ar: 'Arabic' },
};

const pickLang = (he, en, lang) => (lang === 'en' ? en || he : he || en) || null;

/** The coordination contact: coordinator role wins, then primary, then first. */
export function coordinationContact(deal) {
  const links = deal?.contacts || [];
  return (
    links.find((l) => (l.roles || []).includes('coordinator'))
    || links.find((l) => l.isPrimary)
    || links[0]
  )?.contact || null;
}

/**
 * THE registered participant count for ONE booking.
 *
 * Seat truth is TicketRegistration, not `Booking.seats` — the booking row is
 * CRM linkage and can drift. `Booking.seats` is used only when the booking has
 * no registrations at all (2 of 400 in production), so the number is never
 * silently zero for a real customer.
 *
 * Held reservations count: a held seat is a probable arrival, and the guide is
 * about to ask the customer how many are actually coming.
 */
export function bookingSeatCount(booking) {
  const regs = booking?.ticketRegistrations || [];
  if (regs.length) return regs.reduce((n, r) => n + (r.quantity || 0), 0);
  return booking?.seats != null ? booking.seats : null;
}

const contactName = (c, lang) => {
  if (!c) return null;
  const he = [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ').trim();
  const en = [c.firstNameEn, c.lastNameEn].filter(Boolean).join(' ').trim();
  return pickLang(he, en, lang);
};

// ── the catalog ──────────────────────────────────────────────────────────────
// Each field: stable `key` (stored in config, never renamed), default labels,
// and `resolve(scope, lang)` over the loaded booking graph. `rich: true` marks
// HTML that must go through the canonical renderer rather than being escaped.

export const CONTEXT_FIELDS = [
  {
    key: 'tour_name',
    labelHe: 'הפעילות', labelEn: 'Activity',
    // Product name in the rendering language; generic fallback when the tour
    // has no product. NEVER Deal.title — internal CRM wording must not reach
    // a coordination form (privacy rule, displayFallbacks.js).
    resolve: ({ tour }, lang) =>
      pickLang(tour?.product?.nameHe, tour?.product?.nameEn, lang)
      || (lang === 'en' ? GENERIC_ACTIVITY_EN : GENERIC_ACTIVITY_HE),
  },
  {
    key: 'product',
    labelHe: 'מוצר', labelEn: 'Product',
    resolve: ({ tour }, lang) => pickLang(tour?.product?.nameHe, tour?.product?.nameEn, lang),
  },
  {
    key: 'variant_location',
    labelHe: 'מיקום', labelEn: 'Location',
    // The variant IS its city (the same rule the calendar and reports use).
    resolve: ({ tour }, lang) => pickLang(
      tour?.productVariant?.location?.nameHe || tour?.location?.nameHe,
      tour?.productVariant?.location?.nameEn || tour?.location?.nameEn,
      lang,
    ),
  },
  {
    key: 'tour_date',
    labelHe: 'תאריך', labelEn: 'Date',
    resolve: ({ tour }) => (tour?.date ? formatDateHe(tour.date) : null),
  },
  {
    key: 'tour_time',
    labelHe: 'שעה', labelEn: 'Time',
    resolve: ({ tour }) => tour?.startTime || null,
  },
  {
    key: 'customer_name',
    labelHe: 'איש קשר', labelEn: 'Contact',
    resolve: ({ deal }, lang) => contactName(coordinationContact(deal), lang),
  },
  {
    key: 'customer_phone',
    labelHe: 'טלפון', labelEn: 'Phone',
    resolve: ({ deal }) => coordinationContact(deal)?.phones?.[0]?.value || null,
  },
  {
    key: 'organization',
    labelHe: 'ארגון', labelEn: 'Organization',
    resolve: ({ deal }) => deal?.organization?.name || null,
  },
  {
    key: 'participants',
    labelHe: 'משתתפים רשומים', labelEn: 'Registered participants',
    // THIS booking's seats — never the tour total, which on an open tour is
    // the sum of unrelated customers.
    resolve: ({ booking }) => {
      const n = bookingSeatCount(booking);
      return n === null ? null : String(n);
    },
  },
  {
    key: 'tour_language',
    labelHe: 'שפת הסיור', labelEn: 'Tour language',
    resolve: ({ tour, deal }, lang) => {
      const code = tour?.tourLanguage || deal?.tourLanguage;
      return code ? (TOUR_LANG_LABELS[lang === 'en' ? 'en' : 'he'][code] || code) : null;
    },
  },
  {
    key: 'team',
    labelHe: 'צוות', labelEn: 'Team',
    resolve: ({ tour }, lang) => {
      const names = (tour?.assignments || [])
        .map((a) => (a.personRef ? staffName(a.personRef, lang) : a.displayName))
        .filter(Boolean);
      return names.length ? names.join(', ') : null;
    },
  },
  {
    key: 'customer_info',
    labelHe: 'מידע חשוב על הלקוח', labelEn: 'Important customer information',
    rich: true,
    // Deal.customerInfo — the internal working note the office keeps about this
    // customer. Rich HTML, so it renders through the canonical renderer.
    resolve: ({ deal }) => deal?.customerInfo || null,
  },
  {
    key: 'tour_notes',
    labelHe: 'הערות תפעוליות לסיור', labelEn: 'Tour operational notes',
    // TourEvent.notes — the execution layer's own notes, deliberately separate
    // from the Deal's commercial ones.
    resolve: ({ tour }) => tour?.notes || null,
  },
  {
    key: 'booking_notes',
    labelHe: 'הערות להזמנה', labelEn: 'Booking notes',
    // Booking.notes — THIS deal on THIS tour. On an open tour it is the only
    // note that belongs to one customer rather than to everyone.
    resolve: ({ booking }) => booking?.notes || null,
  },
  {
    key: 'deal_notes',
    labelHe: 'הערות הזמנה מסחריות', labelEn: 'Commercial notes',
    resolve: ({ deal }) => deal?.notes || null,
  },
];

// NOT in the catalog, deliberately: "child ages" and "accessibility / special
// requirements". Neither has a canonical field anywhere in the schema — the
// only match in the whole datamodel is a product's marketing line. Inventing a
// Deal column for them is a NEW BUSINESS CONCEPT and needs its own proposal, so
// the honest catalog omits them rather than resolving them to null forever or
// silently repurposing a free-text note that means something else.

export const CONTEXT_FIELD_KEYS = CONTEXT_FIELDS.map((f) => f.key);

export function contextFieldByKey(key) {
  return CONTEXT_FIELDS.find((f) => f.key === key) || null;
}

/** The picker payload — what the settings screen offers, never a free text box. */
export function contextCatalogForPicker() {
  return CONTEXT_FIELDS.map((f) => ({
    key: f.key, labelHe: f.labelHe, labelEn: f.labelEn, rich: !!f.rich,
  }));
}

/**
 * The operator's configuration → the rendered block.
 *
 * `config` is [{ key, enabled, labelHe, labelEn }] in display order. An unknown
 * key is DROPPED rather than rendered blank: a field removed from the catalog
 * must not leave a mystery row on a live form.
 *
 * A field with no value is omitted entirely — a coordination form shows what is
 * known, never a column of empty labels.
 */
export function renderContextBlock(config, scope, lang = 'he') {
  const out = [];
  for (const item of config || []) {
    if (item?.enabled === false) continue;
    const field = contextFieldByKey(item?.key);
    if (!field) continue;
    let value = null;
    try {
      value = field.resolve(scope, lang);
    } catch {
      value = null; // one bad field never takes down the whole block
    }
    if (value === null || value === undefined || String(value).trim() === '') continue;
    out.push({
      key: field.key,
      label: (lang === 'en' ? item.labelEn || field.labelEn : item.labelHe || field.labelHe),
      value: String(value),
      rich: !!field.rich,
    });
  }
  return out;
}

/** The default configuration for a form that has never been configured. */
export function defaultContextConfig() {
  return CONTEXT_FIELDS.map((f) => ({
    key: f.key,
    // Everything the office already asks about on a coordination call is on by
    // default; the operator turns OFF what they do not want.
    enabled: true,
    labelHe: f.labelHe,
    labelEn: f.labelEn,
  }));
}
