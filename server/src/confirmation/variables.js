// Confirmation Email — the CANONICAL customer-facing variable catalog.
//
// A curated ALLOWLIST (the accountingDocNotes BANK_VARIABLES precedent), NOT
// the Communication Center registry: that registry carries staff/internal
// keys (staff_*, deal_link, lead_source, deal_owner…) that must never be
// insertable into a customer confirmation email. ONE catalog serves the
// editor picker (via GET / meta), preview validation, composer rendering and
// missing-variable warnings — there is no second list in the client.
//
// Every entry: key, labelHe, labelEn, descriptionHe (picker explanation),
// category (picker grouping), resolve(ctx, lang) → string|null. A token whose
// resolve returns empty renders as '' and surfaces a labeled
// `missing_variable` warning in the preview — availability is visible, never
// silent. Language rule: values follow the SENDING language with the same
// strictness the composer uses (names never fall back across languages).

import { durationHe, durationEn } from '../../../shared/duration.mjs';
import { effectiveActivityType } from '../../../shared/dealActivity.mjs';
import {
  TOUR_LANG_LABELS,
  ACTIVITY_TYPE_LABELS,
  formatMoney,
} from '../communication/format.js';

const pickStrict = (he, en, lang) => (lang === 'en' ? en : he) || null;
const pickLoose = (he, en, lang) => (lang === 'en' ? en || he : he || en) || null;

export const CONFIRMATION_VARIABLE_CATEGORIES = {
  customer: 'לקוח',
  org: 'ארגון',
  deal: 'עסקה',
  activity: 'פעילות',
  location: 'מיקום',
  special: 'תנאים מיוחדים',
  brand: 'גרפיטיול',
};

// "YYYY-MM-DD" → localized (mirrors the composer's tour-details formatting).
function fmtDate(dateStr, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return dateStr || null;
  const [, y, mo, d] = m;
  return lang === 'en' ? `${d}/${mo}/${y}` : `${Number(d)}.${Number(mo)}.${y}`;
}

export const CONFIRMATION_VARIABLES = [
  // ── לקוח ───────────────────────────────────────────────────────────────────
  {
    key: 'customer_first_name', category: 'customer',
    labelHe: 'שם פרטי', labelEn: 'First name',
    descriptionHe: 'שם פרטי של איש הקשר, בשפת השליחה',
    resolve: (ctx, lang) => pickStrict(ctx.contact?.firstNameHe, ctx.contact?.firstNameEn, lang),
  },
  {
    key: 'customer_last_name', category: 'customer',
    labelHe: 'שם משפחה', labelEn: 'Last name',
    descriptionHe: 'שם משפחה של איש הקשר, בשפת השליחה',
    resolve: (ctx, lang) => pickStrict(ctx.contact?.lastNameHe, ctx.contact?.lastNameEn, lang),
  },
  {
    key: 'customer_full_name', category: 'customer',
    labelHe: 'שם מלא', labelEn: 'Full name',
    descriptionHe: 'שם מלא של איש הקשר, בשפת השליחה',
    resolve: (ctx, lang) => {
      const parts = [
        pickStrict(ctx.contact?.firstNameHe, ctx.contact?.firstNameEn, lang),
        pickStrict(ctx.contact?.lastNameHe, ctx.contact?.lastNameEn, lang),
      ].filter(Boolean);
      return parts.join(' ') || null;
    },
  },
  {
    key: 'customer_email', category: 'customer',
    labelHe: 'אימייל הלקוח', labelEn: 'Customer email',
    descriptionHe: 'כתובת המייל שאליה נשלח מייל האישור',
    resolve: (ctx) => ctx.email || null,
  },
  {
    key: 'customer_phone', category: 'customer',
    labelHe: 'טלפון הלקוח', labelEn: 'Customer phone',
    descriptionHe: 'מספר הטלפון הראשי של איש הקשר',
    resolve: (ctx) => ctx.contactPhone || null,
  },
  // ── ארגון ──────────────────────────────────────────────────────────────────
  {
    key: 'org_name', category: 'org',
    labelHe: 'שם הארגון', labelEn: 'Organization name',
    descriptionHe: 'שם הארגון המקושר לעסקה (ריק בעסקה פרטית)',
    resolve: (ctx) => ctx.deal?.organization?.name || null,
  },
  {
    key: 'org_type', category: 'org',
    labelHe: 'סוג הארגון', labelEn: 'Organization type',
    descriptionHe: 'סוג הארגון (בית ספר, סוכנות…), בשפת השליחה',
    resolve: (ctx, lang) => {
      const t = ctx.deal?.organization?.organizationType || ctx.deal?.organizationType;
      return t ? pickLoose(t.label, t.labelEn, lang) : null;
    },
  },
  // ── עסקה ───────────────────────────────────────────────────────────────────
  {
    key: 'deal_number', category: 'deal',
    labelHe: 'מספר הזמנה', labelEn: 'Order number',
    descriptionHe: 'מספר ההזמנה של העסקה (מוצג ללקוח)',
    resolve: (ctx) => (ctx.deal?.orderNo != null ? String(ctx.deal.orderNo) : null),
  },
  {
    key: 'group_name', category: 'deal',
    labelHe: 'שם הקבוצה', labelEn: 'Group name',
    descriptionHe: 'שם הקבוצה כפי שהוגדר בעסקה',
    resolve: (ctx) => ctx.deal?.groupName || null,
  },
  {
    key: 'activity_type', category: 'deal',
    labelHe: 'סוג הפעילות', labelEn: 'Activity type',
    descriptionHe: 'קבוצתי / פרטי / עסקי, בשפת השליחה',
    // THE shared resolver (shared/dealActivity.mjs) — an explicit activity type
    // is authoritative; a linked organization answers only when nothing was
    // chosen. Never re-derived inline.
    resolve: (ctx, lang) => {
      const key = effectiveActivityType(ctx.deal);
      return key ? ACTIVITY_TYPE_LABELS[lang === 'en' ? 'en' : 'he']?.[key] || null : null;
    },
  },
  {
    key: 'total_amount', category: 'deal',
    labelHe: 'סכום העסקה', labelEn: 'Agreed amount',
    descriptionHe: 'הסכום שסוכם, כולל סימן מטבע (השתמשו בשיקול דעת)',
    resolve: (ctx) =>
      ctx.deal?.valueMinor != null ? formatMoney(Number(ctx.deal.valueMinor), ctx.deal.currency) : null,
  },
  // ── פעילות ─────────────────────────────────────────────────────────────────
  {
    key: 'tour_product', category: 'activity',
    labelHe: 'שם הפעילות', labelEn: 'Activity name',
    descriptionHe: 'שם המוצר/הסיור, בשפת השליחה',
    resolve: (ctx, lang) => pickLoose(ctx.deal?.product?.nameHe, ctx.deal?.product?.nameEn, lang),
  },
  {
    key: 'tour_date', category: 'activity',
    labelHe: 'תאריך הפעילות', labelEn: 'Activity date',
    descriptionHe: 'תאריך הסיור בפורמט מקומי',
    resolve: (ctx, lang) => fmtDate(ctx.deal?.tourDate, lang),
  },
  {
    key: 'tour_time', category: 'activity',
    labelHe: 'שעת הפעילות', labelEn: 'Activity time',
    descriptionHe: 'שעת ההתחלה של הסיור',
    resolve: (ctx) => ctx.deal?.tourTime || null,
  },
  {
    key: 'tour_language', category: 'activity',
    labelHe: 'שפת הפעילות', labelEn: 'Activity language',
    descriptionHe: 'השפה שבה תועבר הפעילות (לא שפת התקשורת) — מהסיור המשובץ, אחרת מהעסקה',
    resolve: (ctx, lang) => {
      // Canonical ACTIVITY language: the booked tour's own language beats the
      // deal working copy. NEVER the communication language.
      const code = ctx.tour?.tourLanguage || ctx.deal?.tourLanguage;
      return code ? TOUR_LANG_LABELS[lang === 'en' ? 'en' : 'he']?.[code] || null : null;
    },
  },
  {
    key: 'participants', category: 'activity',
    labelHe: 'מספר משתתפים', labelEn: 'Participants',
    descriptionHe: 'מספר המשתתפים בעסקה',
    resolve: (ctx) => (ctx.deal?.participants != null ? String(ctx.deal.participants) : null),
  },
  {
    key: 'tour_bookings_count', category: 'activity',
    labelHe: 'מספר הזמנות בסיור', labelEn: 'Bookings on tour',
    descriptionHe: 'כמה הזמנות פעילות משובצות לסיור (רלוונטי לסיורים פתוחים/קבוצתיים)',
    resolve: (ctx) => (ctx.tourBookingsCount != null ? String(ctx.tourBookingsCount) : null),
  },
  // ── מיקום ──────────────────────────────────────────────────────────────────
  {
    key: 'tour_city', category: 'location',
    labelHe: 'עיר הפעילות', labelEn: 'Activity city',
    descriptionHe: 'שם המיקום/העיר, בשפת השליחה',
    resolve: (ctx, lang) => pickLoose(ctx.deal?.location?.nameHe, ctx.deal?.location?.nameEn, lang),
  },
  {
    key: 'meeting_point', category: 'location',
    labelHe: 'נקודת המפגש (טקסט)', labelEn: 'Meeting point (text)',
    descriptionHe: 'נקודת המפגש כטקסט — מהשרשרת הקנונית (וריאציה ← מיקום)',
    resolve: (ctx) => ctx.meetingPoint?.text || null,
  },
  // ── תנאים מיוחדים ──────────────────────────────────────────────────────────
  {
    key: 'effective_duration', category: 'special',
    labelHe: 'משך הפעילות', labelEn: 'Activity duration',
    descriptionHe: 'המשך בפועל — כולל שינוי שסוכם בעסקה (פילר), בשפת השליחה',
    resolve: (ctx, lang) =>
      ctx.effectiveDurationHours != null
        ? (lang === 'en' ? durationEn : durationHe)(ctx.effectiveDurationHours) || null
        : null,
  },
  // ── גרפיטיול ───────────────────────────────────────────────────────────────
  {
    key: 'team_name', category: 'brand',
    labelHe: 'חתימת הצוות', labelEn: 'Team signature',
    descriptionHe: 'שם הצוות בשפת השליחה (״צוות גרפיטיול״)',
    resolve: (_ctx, lang) => (lang === 'en' ? 'The Grafitiyul team' : 'צוות גרפיטיול'),
  },
  {
    key: 'brand_whatsapp', category: 'brand',
    labelHe: 'וואטסאפ ליצירת קשר', labelEn: 'Contact WhatsApp',
    descriptionHe: 'מספר הוואטסאפ הציבורי (מוגדר במבנה הצעת המחיר → צור קשר)',
    resolve: (ctx) => ctx.brandContact?.whatsapp || null,
  },
  {
    key: 'brand_email', category: 'brand',
    labelHe: 'אימייל ליצירת קשר', labelEn: 'Contact email',
    descriptionHe: 'כתובת המייל הציבורית (מוגדרת במבנה הצעת המחיר → צור קשר)',
    resolve: (ctx) => ctx.brandContact?.email || null,
  },
];

export const CONFIRMATION_VARIABLE_KEYS = CONFIRMATION_VARIABLES.map((v) => v.key);
const BY_KEY = Object.fromEntries(CONFIRMATION_VARIABLES.map((v) => [v.key, v]));

export function confirmationVariableByKey(key) {
  return BY_KEY[key] || null;
}

/** Picker/meta payload — everything except the resolver. */
export function listConfirmationVariables() {
  return CONFIRMATION_VARIABLES.map(({ resolve, ...meta }) => meta);
}

/**
 * Resolve the full catalog for a composed context. Unknown keys are simply
 * not in the map (substitution leaves them raw — the amber unknown-chip is
 * the editor-side signal); empty values render '' and are reported with their
 * label so the preview can warn specifically.
 */
export function resolveConfirmationVariables(ctx, lang) {
  const values = {};
  const missing = [];
  for (const v of CONFIRMATION_VARIABLES) {
    let val = null;
    try {
      val = v.resolve(ctx, lang);
    } catch {
      val = null;
    }
    values[v.key] = val ?? '';
    if (!val) missing.push({ key: v.key, label: v.labelHe });
  }
  return { values, missing };
}
