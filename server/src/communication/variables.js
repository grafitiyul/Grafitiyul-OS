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
import { adminDisplayName } from '../admin/displayName.js';
import { ingressLabel } from '../deals/marketing.js';
import { GENERIC_ACTIVITY_EN, GENERIC_ACTIVITY_HE } from '../displayFallbacks.js';
import { effectiveActivityType } from '../../../shared/dealActivity.mjs';
import {
  TOUR_LANG_LABELS, ACTIVITY_TYPE_LABELS, formatDateHe, formatMoney, tourChangeDescription,
} from './format.js';
import { naturalDateLabel } from './naturalDate.js';
import { staffFirstName, staffName } from '../../../shared/staffName.mjs';

// category → Hebrew group label for the editor menu.
export const VARIABLE_CATEGORIES = {
  customer: 'לקוח',
  org: 'ארגון',
  deal: 'דיל',
  tour: 'סיור',
  payment: 'תשלום',
  docs: 'מסמכים וקישורים',
  staff: 'איש צוות',
};

// Staff lifecycle → business label (never the enum). Mirrors the צוות module's
// display language; null lifecycle is a legacy working guide, honestly missing.
const STAFF_TYPE_LABELS = {
  trainee: 'מתלמד/ת',
  staff: 'צוות',
  evaluator: 'ממשב/ת',
  former: 'עזב/ה',
};

// Staff names go through THE canonical staff-name resolver, not a local split
// of displayName: PersonProfile owns the structured he/en name fields, and the
// language rule ("each language uses its own name, the other beats nothing")
// already lives there. Splitting displayName here was a weaker second copy that
// could not answer an English message at all.
const staffLastName = (person, lang) => {
  const full = staffName(person, lang);
  const first = staffFirstName(person, lang);
  return full && first && full.startsWith(first) ? full.slice(first.length).trim() : '';
};

// contexts: which trigger contexts provide the value (triggers.js `contexts`).
export const VARIABLES = [
  // ── customer ──
  // `strictLanguage` (see resolveVariables): return ONLY the name recorded in the
  // requested language, never the other one. A Hebrew given name inside an
  // English message is wrong, not a helpful fallback — an empty greeting is
  // correct there. Off by default so existing consumers are unaffected.
  { key: 'customer_first_name', labelHe: 'שם פרטי של הלקוח', labelEn: 'Customer first name', category: 'customer', contexts: ['contact'],
    resolve: (ctx, lang, opts) => {
      const he = ctx.contact?.firstNameHe || null;
      const en = ctx.contact?.firstNameEn || null;
      if (opts?.strictLanguage) return (lang === 'en' ? en : he) || null;
      return (lang === 'en' ? en || he : he || en) || null;
    } },
  { key: 'customer_full_name', labelHe: 'שם מלא של הלקוח', labelEn: 'Customer full name', category: 'customer', contexts: ['contact'],
    resolve: (ctx, lang, opts) => contactFullName(ctx.contact, lang, opts) },
  { key: 'customer_phone', labelHe: 'טלפון הלקוח', labelEn: 'Customer phone', category: 'customer', contexts: ['contact'],
    resolve: (ctx) => contactPhone(ctx.contact) },
  { key: 'customer_email', labelHe: 'אימייל הלקוח', labelEn: 'Customer email', category: 'customer', contexts: ['contact'],
    resolve: (ctx) => contactEmail(ctx.contact) },

  // ── organization ──
  { key: 'org_name', labelHe: 'שם הארגון', labelEn: 'Organization name', category: 'org', contexts: ['org'],
    resolve: (ctx) => ctx.org?.name || null },
  { key: 'org_type', labelHe: 'סוג הארגון', labelEn: 'Organization type', category: 'org', contexts: ['org'],
    resolve: (ctx, lang) => (lang === 'en' ? ctx.org?.organizationType?.labelEn || ctx.org?.organizationType?.label : ctx.org?.organizationType?.label) || null },
  { key: 'sub_organization', labelHe: 'תת-ארגון', labelEn: 'Sub-organization', category: 'org', contexts: ['org', 'deal'],
    // The deal's OrganizationUnit (the org-hierarchy child), never the parent
    // organization; a deal without a unit ⇒ honest missing value.
    resolve: (ctx) => ctx.deal?.organizationUnit?.name || null },

  // ── deal ──
  { key: 'deal_number', labelHe: 'מספר הזמנה', labelEn: 'Order number', category: 'deal', contexts: ['deal'],
    resolve: (ctx) => (ctx.deal?.orderNo != null ? String(ctx.deal.orderNo) : null) },
  // deal_title is the ONE approved Deal.title exposure in all of GOS: an
  // EXPLICIT operator choice, labeled as the internal deal name. Every other
  // customer-facing resolver must use canonical sources + displayFallbacks.js
  // (see the dealTitleGuard test and the CLAUDE.md invariant).
  { key: 'deal_title', labelHe: 'שם הדיל', labelEn: 'Deal title', category: 'deal', contexts: ['deal'],
    resolve: (ctx) => ctx.deal?.title || null },
  { key: 'group_name', labelHe: 'שם הקבוצה', labelEn: 'Group name', category: 'deal', contexts: ['deal'],
    // Real group name → product/activity name → generic. NEVER Deal.title —
    // internal CRM wording must not leak through a silent fallback.
    resolve: (ctx, lang) => {
      if (ctx.deal?.groupName) return ctx.deal.groupName;
      const product = ctx.tour?.product || ctx.deal?.product || null;
      const productName = lang === 'en'
        ? product?.nameEn || product?.nameHe
        : product?.nameHe || product?.nameEn;
      return productName || (lang === 'en' ? GENERIC_ACTIVITY_EN : GENERIC_ACTIVITY_HE);
    } },
  { key: 'deal_link', labelHe: 'קישור לדיל (פנימי)', labelEn: 'Deal link (internal)', category: 'deal', contexts: ['deal'],
    // Canonical internal route (the client dealPath convention: orderNo IS the URL).
    resolve: (ctx) => (ctx.deal?.orderNo != null && ctx.links?.origin
      ? `${ctx.links.origin}/admin/crm/deals/${ctx.deal.orderNo}` : null) },
  { key: 'deal_owner', labelHe: 'בעלים של הדיל', labelEn: 'Deal owner', category: 'deal', contexts: ['deal'],
    // Canonical admin display-name contract; no owner ⇒ honest missing value
    // (never another person's name substituted).
    resolve: (ctx) => (ctx.owner ? adminDisplayName(ctx.owner) || null : null) },
  { key: 'activity_type', labelHe: 'סוג הפעילות', labelEn: 'Activity type', category: 'deal', contexts: ['deal'],
    // Business label, never the enum. THE shared resolver
    // (shared/dealActivity.mjs) — same answer the condition evaluator and the
    // confirmation template matcher get, by construction.
    resolve: (ctx, lang) => {
      const type = effectiveActivityType(ctx.deal);
      return type ? ACTIVITY_TYPE_LABELS[lang === 'en' ? 'en' : 'he'][type] || null : null;
    } },
  { key: 'lead_source', labelHe: 'מקור הליד', labelEn: 'Lead source', category: 'deal', contexts: ['deal'],
    // The REAL recorded source, never fabricated: the deal's source catalog
    // entry, else the canonical write-once ingress provenance label
    // (DealMarketing.originalIngressSource), else the free-text source detail.
    resolve: (ctx) =>
      ctx.deal?.dealSource?.label
      || ingressLabel(ctx.deal?.marketing?.originalIngressSource)
      || ctx.deal?.source
      || null },
  // ── OPTIONAL whole-line variables (manager lead alert) ──
  // `optional: true` — an absent value renders as NOTHING instead of blocking
  // the delivery. Each resolves to a full labelled line WITH its own trailing
  // newline, so the template never shows an empty label or a blank line: place
  // the token at the start of the line that follows it.
  { key: 'lead_org_line', labelHe: 'שורת ארגון (אם קיים)', labelEn: 'Organization line (if present)', category: 'org', contexts: ['org', 'deal'], optional: true,
    resolve: (ctx, lang) => {
      const name = ctx.org?.name || null;
      if (!name) return '';
      return lang === 'en' ? `Organization: ${name}\n` : `ארגון: ${name}\n`;
    } },
  { key: 'lead_interest_line', labelHe: 'שורת תחום עניין (אם ידוע)', labelEn: 'Interest line (if known)', category: 'deal', contexts: ['deal'], optional: true,
    resolve: (ctx, lang) => {
      const p = ctx.deal?.product;
      const name = (lang === 'en' ? p?.nameEn || p?.nameHe : p?.nameHe || p?.nameEn) || null;
      if (!name) return '';
      return lang === 'en' ? `Interest: ${name}\n` : `עניין: ${name}\n`;
    } },

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
  // The SAME date, phrased the way a person writing a message says it: היום /
  // אתמול / יום שני / 3.7. One humanizer (communication/naturalDate.js) so a
  // preview and the message that actually leaves can never render it
  // differently. `ctx.nowMs` is honoured when a caller pins the clock.
  { key: 'tour_date_natural', labelHe: 'תאריך הסיור (ניסוח טבעי)', labelEn: 'Tour date (natural)', category: 'tour', contexts: ['deal', 'tour'],
    resolve: (ctx, lang) => naturalDateLabel(ctx.tour?.date || ctx.deal?.tourDate, lang, ctx.nowMs ?? Date.now()) },
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

  // ── tour datetime change (tour_datetime_changed trigger payload) ──
  { key: 'tour_prev_date', labelHe: 'תאריך קודם של הסיור', labelEn: 'Previous tour date', category: 'tour', contexts: ['change'],
    resolve: (ctx) => formatDateHe(ctx.triggerData?.prevDate) },
  { key: 'tour_prev_time', labelHe: 'שעה קודמת של הסיור', labelEn: 'Previous tour time', category: 'tour', contexts: ['change'],
    resolve: (ctx) => ctx.triggerData?.prevTime || null },
  { key: 'tour_new_date', labelHe: 'תאריך חדש של הסיור', labelEn: 'New tour date', category: 'tour', contexts: ['change'],
    resolve: (ctx) => formatDateHe(ctx.triggerData?.newDate) },
  { key: 'tour_new_time', labelHe: 'שעה חדשה של הסיור', labelEn: 'New tour time', category: 'tour', contexts: ['change'],
    resolve: (ctx) => ctx.triggerData?.newTime || null },
  { key: 'tour_change_description', labelHe: 'תיאור שינוי המועד', labelEn: 'Change description', category: 'tour', contexts: ['change'],
    resolve: (ctx, lang) => tourChangeDescription(ctx.triggerData, lang) },

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

  // ── staff (context 'staff' — staff-directed sends only; no communication
  //    trigger provides this context, so these never appear in the customer-
  //    facing editor menus). ctx.staff = { person: PersonRef(+team), portalUrl }.
  { key: 'staff_first_name', labelHe: 'שם פרטי של איש הצוות', labelEn: 'Staff first name', category: 'staff', contexts: ['staff'],
    resolve: (ctx, lang) => staffFirstName(ctx.staff?.person, lang) || null },
  { key: 'staff_last_name', labelHe: 'שם משפחה של איש הצוות', labelEn: 'Staff last name', category: 'staff', contexts: ['staff'],
    resolve: (ctx, lang) => staffLastName(ctx.staff?.person, lang) || null },
  { key: 'staff_full_name', labelHe: 'שם מלא של איש הצוות', labelEn: 'Staff full name', category: 'staff', contexts: ['staff'],
    resolve: (ctx, lang) => staffName(ctx.staff?.person, lang) || null },
  { key: 'staff_phone', labelHe: 'טלפון איש הצוות', labelEn: 'Staff phone', category: 'staff', contexts: ['staff'],
    resolve: (ctx) => String(ctx.staff?.person?.phone || '').trim() || null },
  { key: 'staff_email', labelHe: 'אימייל איש הצוות', labelEn: 'Staff email', category: 'staff', contexts: ['staff'],
    resolve: (ctx) => String(ctx.staff?.person?.email || '').trim() || null },
  { key: 'staff_team', labelHe: 'צוות שיוך', labelEn: 'Staff team', category: 'staff', contexts: ['staff'],
    resolve: (ctx) => ctx.staff?.person?.team?.displayName || null },
  { key: 'staff_type', labelHe: 'סוג איש הצוות', labelEn: 'Staff type', category: 'staff', contexts: ['staff'],
    resolve: (ctx) => STAFF_TYPE_LABELS[ctx.staff?.person?.lifecycleHint] || null },
  { key: 'staff_portal_link', labelHe: 'קישור לפורטל האישי', labelEn: 'Personal portal link', category: 'staff', contexts: ['staff'],
    // Pre-built by the caller via tours/guidePortal/links.js guidePortalUrl —
    // the ONE canonical builder (portalEnabled respected: revoked ⇒ missing,
    // never a link that 403s when tapped).
    resolve: (ctx) => ctx.staff?.portalUrl || null },
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
 *
 * `opts.strictLanguage` forbids cross-language substitution for the per-language
 * name variables: a message rendered in English must never carry a Hebrew given
 * name. Callers opt in; the automated delivery engine keeps its existing
 * fallback behaviour untouched.
 */
export function resolveVariables(keys, ctx, lang = 'he', opts = undefined) {
  const values = {};
  const missing = [];
  const unknown = [];
  for (const key of keys) {
    const def = BY_KEY.get(key);
    if (!def) { unknown.push(key); continue; }
    let v = null;
    try { v = def.resolve(ctx, lang, opts); } catch { v = null; }
    // An OPTIONAL variable with no value substitutes as nothing rather than
    // blocking the send — declared per-variable in the registry (whole-line
    // variables like lead_org_line), never inferred.
    if (def.optional) {
      values[key] = v ?? '';
      continue;
    }
    values[key] = v ?? null;
    if (v == null || v === '') missing.push(key);
  }
  return { values, missing, unknown };
}

// Preview-only readable marker for a recognized variable with no value in the
// current context. Live sends never render this — the worker blocks on missing
// values first. Unknown keys stay raw {{key}} and are flagged separately.
function missingMarker(key) {
  const def = BY_KEY.get(key);
  return def ? `⟨${def.labelHe} — חסר⟩` : null;
}

/** Substitute {{key}} tokens in PLAIN text (WhatsApp markup / email subject). */
export function substituteTokens(text, values, { missingLabels = false } = {}) {
  return String(text ?? '').replace(TOKEN_RE, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key) && values[key] != null) return values[key];
    if (missingLabels) return missingMarker(key) ?? m;
    return m;
  });
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Replace chip spans + raw tokens in EMAIL HTML with escaped resolved values. */
export function substituteHtmlTokens(html, values, { missingLabels = false } = {}) {
  const missing = (key) => {
    if (missingLabels) {
      const marker = missingMarker(key);
      if (marker) return `<span style="color:#b45309">${escapeHtml(marker)}</span>`;
    }
    return `{{${key}}}`;
  };
  let out = String(html ?? '');
  // Chip spans: <span data-type="dynamic-field" data-field-key="x">label</span>
  out = out.replace(
    /<span[^>]*data-field-key="([a-z][a-z0-9_]*)"[^>]*>([\s\S]*?)<\/span>/g,
    (m, key) => {
      const v = values[key];
      return v != null ? escapeHtml(v) : missing(key);
    },
  );
  // Raw tokens typed as text.
  out = out.replace(TOKEN_RE, (m, key) => {
    const v = values[key];
    return v != null ? escapeHtml(v) : (missingLabels ? missing(key) : m);
  });
  return out;
}
