// THE canonical communication variable registry + resolver.
//
// One registry serves everything: the editor's "הוסף משתנה" menu (via
// GET /api/communication/variables — the client never keeps its own copy, so
// the lists can't drift), validation at publish time, the preview, and the
// live delivery renderer. Stored content carries ONLY the stable key
// ({{key}} / chip data-field-key) — labels are presentation.
//
// Resolution reads exclusively from the loaded trigger context (context.js).
// A missing value is NEVER silently substituted: rendering reports missing
// keys and the delivery policy decides (preview shows them; live sends fail
// validation for required-empty variables rather than sending "שלום {{x}}").

import { contactPhone, contactEmail, contactFullName } from './context.js';
import { TOUR_LANG_LABELS, formatDateHe, formatMoney } from './format.js';

// category → Hebrew group label for the editor menu.
export const VARIABLE_CATEGORIES = {
  customer: 'לקוח',
  org: 'ארגון',
  deal: 'דיל',
  tour: 'סיור',
  payment: 'תשלום',
  docs: 'מסמכים וקישורים',
};

// contexts: which trigger contexts provide the value (triggers.js `contexts`).
export const VARIABLES = [
  // ── customer ──
  { key: 'customer_first_name', labelHe: 'שם פרטי של הלקוח', labelEn: 'Customer first name', category: 'customer', contexts: ['contact'],
    resolve: (ctx, lang) => (lang === 'en' ? ctx.contact?.firstNameEn || ctx.contact?.firstNameHe : ctx.contact?.firstNameHe || ctx.contact?.firstNameEn) || null },
  { key: 'customer_full_name', labelHe: 'שם מלא של הלקוח', labelEn: 'Customer full name', category: 'customer', contexts: ['contact'],
    resolve: (ctx, lang) => contactFullName(ctx.contact, lang) },
  { key: 'customer_phone', labelHe: 'טלפון הלקוח', labelEn: 'Customer phone', category: 'customer', contexts: ['contact'],
    resolve: (ctx) => contactPhone(ctx.contact) },
  { key: 'customer_email', labelHe: 'אימייל הלקוח', labelEn: 'Customer email', category: 'customer', contexts: ['contact'],
    resolve: (ctx) => contactEmail(ctx.contact) },

  // ── organization ──
  { key: 'org_name', labelHe: 'שם הארגון', labelEn: 'Organization name', category: 'org', contexts: ['org'],
    resolve: (ctx) => ctx.org?.name || null },
  { key: 'org_type', labelHe: 'סוג הארגון', labelEn: 'Organization type', category: 'org', contexts: ['org'],
    resolve: (ctx, lang) => (lang === 'en' ? ctx.org?.organizationType?.labelEn || ctx.org?.organizationType?.label : ctx.org?.organizationType?.label) || null },

  // ── deal ──
  { key: 'deal_number', labelHe: 'מספר הזמנה', labelEn: 'Order number', category: 'deal', contexts: ['deal'],
    resolve: (ctx) => (ctx.deal?.orderNo != null ? String(ctx.deal.orderNo) : null) },
  { key: 'deal_title', labelHe: 'שם הדיל', labelEn: 'Deal title', category: 'deal', contexts: ['deal'],
    resolve: (ctx) => ctx.deal?.title || null },
  { key: 'group_name', labelHe: 'שם הקבוצה', labelEn: 'Group name', category: 'deal', contexts: ['deal'],
    resolve: (ctx) => ctx.deal?.groupName || ctx.deal?.title || null },

  // ── tour ──
  { key: 'tour_product', labelHe: 'שם הפעילות', labelEn: 'Activity name', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx, lang) => {
      const p = ctx.tour?.product || ctx.deal?.product;
      return (lang === 'en' ? p?.nameEn || p?.nameHe : p?.nameHe || p?.nameEn) || null;
    } },
  { key: 'tour_city', labelHe: 'עיר הסיור', labelEn: 'Tour city', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx, lang) => {
      const l = ctx.tour?.location || ctx.deal?.location;
      return (lang === 'en' ? l?.nameEn || l?.nameHe : l?.nameHe || l?.nameEn) || null;
    } },
  { key: 'tour_date', labelHe: 'תאריך הסיור', labelEn: 'Tour date', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx, lang) => formatDateHe(ctx.tour?.date || ctx.deal?.tourDate, lang) },
  { key: 'tour_time', labelHe: 'שעת הסיור', labelEn: 'Tour time', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx) => ctx.tour?.startTime || ctx.deal?.tourTime || null },
  { key: 'tour_language', labelHe: 'שפת הסיור', labelEn: 'Tour language', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx, lang) => {
      const code = ctx.tour?.tourLanguage || ctx.deal?.tourLanguage;
      return code ? (TOUR_LANG_LABELS[lang === 'en' ? 'en' : 'he'][code] || code) : null;
    } },
  { key: 'participants', labelHe: 'מספר משתתפים', labelEn: 'Participants', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx) => (ctx.deal?.participants != null ? String(ctx.deal.participants) : null) },
  { key: 'meeting_point', labelHe: 'נקודת מפגש', labelEn: 'Meeting point', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx, lang) => {
      const v = ctx.tour?.productVariant || ctx.deal?.productVariant;
      return (lang === 'en' ? v?.meetingPointEn || v?.meetingPointHe : v?.meetingPointHe || v?.meetingPointEn) || null;
    } },
  { key: 'guide_names', labelHe: 'שמות המדריכים', labelEn: 'Guide names', category: 'tour', contexts: ['tour'],
    resolve: (ctx) => {
      const names = (ctx.tour?.assignments || [])
        .map((a) => a.personRef?.displayName || a.displayName)
        .filter(Boolean);
      return names.length ? names.join(', ') : null;
    } },
  { key: 'field_contact_name', labelHe: 'שם נציג בשטח', labelEn: 'Field contact name', category: 'tour', contexts: ['deal'],
    resolve: (ctx, lang) => contactFullName(ctx.fieldContact, lang) },
  { key: 'field_contact_phone', labelHe: 'טלפון נציג בשטח', labelEn: 'Field contact phone', category: 'tour', contexts: ['deal'],
    resolve: (ctx) => contactPhone(ctx.fieldContact) },

  // ── payment ──
  { key: 'payment_total', labelHe: 'סכום העסקה', labelEn: 'Total amount', category: 'payment', contexts: ['payment'],
    resolve: (ctx) => formatMoney(ctx.payment?.totalMinor, ctx.payment?.currency) },
  { key: 'payment_paid', labelHe: 'סכום ששולם', labelEn: 'Amount paid', category: 'payment', contexts: ['payment'],
    resolve: (ctx) => formatMoney(ctx.payment?.paidMinor, ctx.payment?.currency) },
  { key: 'payment_balance', labelHe: 'יתרה לתשלום', labelEn: 'Outstanding balance', category: 'payment', contexts: ['payment'],
    resolve: (ctx) => formatMoney(ctx.payment?.balanceMinor, ctx.payment?.currency) },
  { key: 'payment_link', labelHe: 'קישור לתשלום', labelEn: 'Payment link', category: 'payment', contexts: ['payment'],
    resolve: (ctx) => ctx.links?.paymentUrl || null },

  // ── documents & links ──
  { key: 'quote_link', labelHe: 'קישור להצעת המחיר', labelEn: 'Quote link', category: 'docs', contexts: ['quote'],
    resolve: (ctx) => (ctx.quoteDoc?.publicToken && ctx.links?.origin ? `${ctx.links.origin}/quote/${ctx.quoteDoc.publicToken}` : null) },
  { key: 'reservation_number', labelHe: 'מספר הזמנת סוכן', labelEn: 'Reservation number', category: 'docs', contexts: ['reservation'],
    resolve: (ctx) => (ctx.reservation?.sessionNo != null ? String(ctx.reservation.sessionNo) : null) },
];

const BY_KEY = new Map(VARIABLES.map((v) => [v.key, v]));

export function variableByKey(key) {
  return BY_KEY.get(key) || null;
}

/** Variables available for a trigger (by its provided contexts) — the editor menu. */
export function variablesForTrigger(triggerContexts) {
  const set = new Set(triggerContexts || []);
  set.add('contact'); // every V1 trigger context carries a contact branch
  return VARIABLES.filter((v) => v.contexts.some((c) => set.has(c)));
}

export const TOKEN_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/** All {{key}} tokens (and chip spans) referenced by a text/HTML string. */
export function extractTokens(text) {
  const keys = new Set();
  const s = String(text ?? '');
  for (const m of s.matchAll(TOKEN_RE)) keys.add(m[1]);
  for (const m of s.matchAll(/data-field-key="([a-z][a-z0-9_]*)"/g)) keys.add(m[1]);
  return [...keys];
}

/**
 * Resolve every variable key against a context → { values: {key: string|null},
 * missing: [key], unknown: [key] }.
 */
export function resolveVariables(keys, ctx, lang = 'he') {
  const values = {};
  const missing = [];
  const unknown = [];
  for (const key of keys) {
    const def = BY_KEY.get(key);
    if (!def) { unknown.push(key); continue; }
    let v = null;
    try { v = def.resolve(ctx, lang); } catch { v = null; }
    values[key] = v ?? null;
    if (v == null || v === '') missing.push(key);
  }
  return { values, missing, unknown };
}

/** Substitute {{key}} tokens in PLAIN text (WhatsApp markup / email subject). */
export function substituteTokens(text, values) {
  return String(text ?? '').replace(TOKEN_RE, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) && values[key] != null ? values[key] : m,
  );
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Replace chip spans + raw tokens in EMAIL HTML with escaped resolved values. */
export function substituteHtmlTokens(html, values) {
  let out = String(html ?? '');
  // Chip spans: <span data-type="dynamic-field" data-field-key="x">label</span>
  out = out.replace(
    /<span[^>]*data-field-key="([a-z][a-z0-9_]*)"[^>]*>([\s\S]*?)<\/span>/g,
    (m, key) => {
      const v = values[key];
      return v != null ? escapeHtml(v) : `{{${key}}}`;
    },
  );
  // Raw tokens typed as text.
  out = out.replace(TOKEN_RE, (m, key) => {
    const v = values[key];
    return v != null ? escapeHtml(v) : m;
  });
  return out;
}
