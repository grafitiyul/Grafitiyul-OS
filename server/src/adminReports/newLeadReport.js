// Report #25 — a new external lead reached GOS.
//
// Replaces AUT-004 and Communication Center message #12. Same business event,
// same trigger, same destination, same words — one implementation instead of
// three hops (Automation Registry → Communication Center → queue).
//
// ── Why the values come from resolveVariables ───────────────────────────────
// The CC message resolved `lead_source`, `lead_org_line` and friends through
// the canonical variable registry, and those resolvers carry real rules: the
// lead source is the deal's recorded source, else the write-once ingress
// provenance label, else the free-text detail — NEVER fabricated. Re-deriving
// any of that here would have produced a second, subtly different answer to
// "where did this lead come from", which is exactly the drift this whole
// migration exists to remove. So the report calls the same resolvers.
//
// ── The optional lines ──────────────────────────────────────────────────────
// `lead_org_line` and `lead_interest_line` are declared `optional` in the
// registry and resolve to '' (with their own trailing newline) when absent, so
// a lead with no organisation produces no blank "ארגון:" label. That behaviour
// is inherited, not reimplemented.

import { resolveVariables } from '../communication/variables.js';

const LEAD_KEYS = [
  'lead_source',
  'customer_full_name',
  'customer_phone',
  'lead_org_line',
  'lead_interest_line',
  'deal_link',
];

/** The resolved values for one lead, in one language. */
function leadValues(ctx, lang) {
  const { values } = resolveVariables(LEAD_KEYS, ctx, lang);
  return values;
}

function body(ctx, lang) {
  const v = leadValues(ctx, lang);
  const he = lang !== 'en';
  // The optional lines already end in "\n" when present and are '' when not,
  // so they are concatenated rather than joined — a join would insert a blank
  // line for an absent organisation.
  const optional = `${v.lead_org_line || ''}${v.lead_interest_line || ''}`;
  return [
    he ? `🆕 ליד חדש מ־${v.lead_source || '—'}` : `🆕 A new lead from ${v.lead_source || '—'}`,
    '',
    `${he ? 'שם' : 'Name'}: ${v.customer_full_name || '—'}`,
    `${he ? 'טלפון' : 'Phone'}: ${v.customer_phone || '—'}`,
    `${optional}${he ? 'דיל' : 'Deal'}:`,
    v.deal_link || '—',
    '',
    he ? 'בהצלחה 💪' : 'Good luck 💪',
  ].join('\n');
}

export const NEW_LEAD_REPORT = {
  number: 25,
  key: 'new_lead_manager_alert',
  nameHe: 'ליד חדש — עדכון מנהלים',
  nameEn: 'New lead — manager alert',
  triggerHe:
    'נורה כשנוצר ליד חדש אמיתי ממקור חיצוני — טופס באתר, מטא, גשר הלידים מ-Pipedrive '
    + 'וכל ערוץ כניסה חיצוני שיתווסף. נורה מקוד הקליטה עצמו ולעולם לא נגזר מהמסך שיצר '
    + 'את הדיל: יצירה ידנית, פתיחת דיל מווטסאפ או ממייל, יצירה מאיש קשר קיים, שכפול, '
    + 'ייבוא, תיקונים וניסיונות חוזרים אינם מגיעים לנתיב הזה כלל.',
  dataHe:
    'מקור הליד הוא המקור שנרשם בפועל (מקור הדיל, אחרת תווית הקליטה הקנונית, אחרת פירוט '
    + 'המקור החופשי) — לעולם לא מומצא. שורות הארגון ותחום העניין מופיעות רק כשיש להן ערך, '
    + 'כך שאין תוויות ריקות. הקישור הוא לדיל ב-GOS.',
  render: (ctx) => body(ctx, 'he'),
  renderEn: (ctx) => body(ctx, 'en'),
  sample: () => ({
    links: { origin: 'https://app.grafitiyul.co.il' },
    deal: {
      orderNo: 27033,
      dealSource: { label: 'טופס באתר' },
      product: { nameHe: 'סיור וסדנת גרפיטי', nameEn: 'Graffiti tour and workshop' },
    },
    org: { name: 'עיריית תל אביב' },
    contact: {
      firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: 'Dana', lastNameEn: 'Levi',
      phones: [{ value: '050-1234567', isPrimary: true }],
    },
  }),
};
