// THE resolver for internal WhatsApp templates — one centralized path, no
// string replacement scattered through UI components.
//
// It deliberately reuses the CANONICAL communication stack rather than inventing
// a parallel one:
//   syntax    → {{key}} moustache + span[data-field-key] chips (variableTokens)
//   registry  → server/src/communication/variables.js (VARIABLES / resolveVariables)
//   context   → loadTriggerContext({ dealId }) — ctx.contact IS the deal's
//               canonical PRIMARY contact (DealContact.isPrimary), and
//               customer_first_name reads the STRUCTURED firstNameHe/firstNameEn
//               field; it never parses a first name out of a display name.
//   serialize → shared/waMarkup.mjs htmlToWhatsApp — the same converter the
//               Communication Center and the editor preview use.
//
// The ONE policy difference from the automated delivery engine: a missing value
// must not block and must never ship as raw moustache. Here a missing variable
// resolves to EMPTY and the surrounding spacing/punctuation is normalized, so
// "היי {{customer_first_name}}," becomes a readable "היי," — which the operator
// then sees and can edit before sending.

import { htmlToWhatsApp } from '../../../shared/waMarkup.mjs';
import { extractTokens, resolveVariables, substituteTokens, variableByKey } from '../communication/variables.js';

// Variables this feature actually supports, PER AUDIENCE. Deliberately narrow:
// the registry can resolve far more, but a template may only reference what
// this slice has specified and verified. Widening = add a key here (plus its
// registry entry if it is genuinely new) — never an ad-hoc substitution
// somewhere else.
//
// The two audiences are separate sets on purpose, because they resolve from
// different context branches:
//   customer — ctx.contact (the deal's primary contact)
//   guide    — ctx.staff (the RECIPIENT guide) + ctx.tour / ctx.deal (the tour
//              being reviewed). A customer-only key inside a guide template
//              would resolve to nothing, so it is rejected at save time rather
//              than silently emptied at send time.
export const TEMPLATE_AUDIENCES = ['customer', 'guide'];
export const DEFAULT_TEMPLATE_AUDIENCE = 'customer';

export const TEMPLATE_VARIABLE_KEYS = ['customer_first_name'];

const GUIDE_TEMPLATE_VARIABLE_KEYS = [
  // The recipient. ctx.staff is the guide this copy is being rendered for, so
  // the canonical staff keys ARE the guide keys — no duplicate resolver.
  'staff_first_name',
  'staff_full_name',
  // The tour. tour_date_natural leads because it is what a person writing a
  // message actually says ("אתמול"); tour_date stays available for the rare
  // template that wants the exact numeric date.
  'tour_date_natural',
  'tour_date',
  'tour_time',
  'tour_product',
  'tour_city',
  // The party the tour was for.
  'customer_full_name',
  'org_name',
  'group_name',
];

const KEYS_BY_AUDIENCE = {
  customer: TEMPLATE_VARIABLE_KEYS,
  guide: GUIDE_TEMPLATE_VARIABLE_KEYS,
};

export function templateAudience(value) {
  const a = String(value || '').trim();
  return TEMPLATE_AUDIENCES.includes(a) ? a : DEFAULT_TEMPLATE_AUDIENCE;
}

/** The allowed variable keys for one audience. */
export function templateVariableKeys(audience = DEFAULT_TEMPLATE_AUDIENCE) {
  return KEYS_BY_AUDIENCE[templateAudience(audience)];
}

// Aliases accepted on INPUT only (never stored, never offered in the picker).
//
// 'first_name' is already taken in the client dynamic-field registry for the
// EMPLOYEE first name (learning module), so the customer's first name stays
// {{customer_first_name}} — but a hand-typed {{first_name}} inside a WhatsApp
// template still resolves to the customer rather than leaking as raw text.
//
// The guide-flavoured spellings map onto the canonical keys for the same
// reason: an operator (or an imported wording) writing {{guide_first_name}}
// gets the guide's first name, and storage still holds exactly one spelling.
const KEY_ALIASES = {
  first_name: 'customer_first_name',
  guide_first_name: 'staff_first_name',
  guide_name: 'staff_full_name',
  guide_full_name: 'staff_full_name',
  customer_name: 'customer_full_name',
  organization_name: 'org_name',
};

export function canonicalTemplateKey(key) {
  const k = String(key || '').toLowerCase();
  return KEY_ALIASES[k] || k;
}

/**
 * Rewrite alias moustache to its canonical spelling BEFORE a body is stored, so
 * the database only ever holds the canonical token ({{first_name}} typed by a
 * user, or arriving from legacy content, is saved as {{customer_first_name}}).
 * Chip spans already carry the canonical key, so they are untouched.
 */
export function canonicalizeTemplateTokens(html) {
  if (!html) return html ?? '';
  return String(html).replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (m, key) => {
    const canonical = canonicalTemplateKey(key);
    return canonical === key ? m : `{{${canonical}}}`;
  });
}

// Business-language help text per supported key. This is a DISPLAY layer over
// the canonical registry (which stores no description), not a second registry —
// keys, labels and resolution all still come from variables.js. It exists so a
// CRM author never has to read `customer_first_name` to understand a chip.
const VARIABLE_HELP_HE = {
  customer_first_name: 'מתמלא אוטומטית בשם הפרטי של הלקוח בדיל',
};

// The guide audience says the same keys differently, because in that dialog the
// "איש צוות" IS the guide and the tour is the subject. Display layer only — the
// stored key and the resolver are the canonical ones.
const GUIDE_LABELS_HE = {
  staff_first_name: 'שם פרטי של המדריך',
  staff_full_name: 'שם מלא של המדריך',
  tour_date_natural: 'תאריך הסיור (ניסוח טבעי)',
  tour_date: 'תאריך הסיור (מספרי)',
  customer_full_name: 'שם הלקוח',
};

const GUIDE_HELP_HE = {
  staff_first_name: 'השם הפרטי של המדריך שההודעה נשלחת אליו',
  staff_full_name: 'השם המלא של המדריך שההודעה נשלחת אליו',
  tour_date_natural: 'נכתב כמו שאומרים: היום, אתמול, יום שני — ותאריך קצר (3.7) לסיור ישן יותר',
  tour_date: 'התאריך המלא של הסיור, בספרות',
  tour_time: 'שעת תחילת הסיור',
  tour_product: 'שם הפעילות',
  tour_city: 'העיר שבה התקיים הסיור',
  customer_full_name: 'שם הלקוח שהסיור בוצע עבורו',
  org_name: 'הארגון שהסיור בוצע עבורו (אם יש)',
  group_name: 'שם הקבוצה (אם אין — שם הפעילות)',
};

/** The picker/menu list for the settings editor (label comes from the registry). */
export function templateVariables(audience = DEFAULT_TEMPLATE_AUDIENCE) {
  const kind = templateAudience(audience);
  return templateVariableKeys(kind).map((key) => {
    const def = variableByKey(key);
    return {
      key,
      labelHe: (kind === 'guide' ? GUIDE_LABELS_HE[key] : null) || def?.labelHe || key,
      labelEn: def?.labelEn || key,
      category: def?.category || 'customer',
      descriptionHe: (kind === 'guide' ? GUIDE_HELP_HE[key] : VARIABLE_HELP_HE[key]) || null,
    };
  });
}

/**
 * Tokens in `html` that this audience does not support — used to reject a body
 * at SAVE time so an unresolvable token can never reach a recipient at all.
 * Recognized aliases count as supported.
 */
export function unsupportedTokens(html, audience = DEFAULT_TEMPLATE_AUDIENCE) {
  const allowed = new Set(templateVariableKeys(audience));
  return [...new Set(extractTokens(html).map(canonicalTemplateKey))].filter((k) => !allowed.has(k));
}

/**
 * Tidy the text after a variable resolved to EMPTY.
 * Only touches the damage an empty substitution causes:
 *   "היי ," → "היי,"   (space before Hebrew/Latin punctuation)
 *   "היי  שלום" → "היי שלום"  (doubled inner space)
 *   "היי ,\n" → "היי,\n" and trailing spaces at end of line
 * Never collapses newlines (blank lines are intentional authored spacing) and
 * never touches text that had no empty substitution.
 */
export function normalizeAfterEmptyFill(text) {
  return String(text ?? '')
    .replace(/[ \t]{2,}/g, ' ') // doubled spaces left by the removed value
    .replace(/[ \t]+([,.;:!?׃־])/g, '$1') // space before punctuation
    .replace(/([({[“"'])[ \t]+/g, '$1') // space after an opening bracket/quote
    .replace(/[ \t]+([)\]}”])/g, '$1') // space before a closing bracket/quote
    .replace(/[ \t]+$/gm, ''); // trailing spaces on any line
}

/**
 * Resolve ONE template body for a context.
 *
 * @param {string} bodyHtml  stored editor HTML (chips + optional raw moustache)
 * @param {object} ctx       loadTriggerContext() result
 * @param {'he'|'en'} lang
 * @returns {{ text:string, values:object, missing:string[], unknown:string[] }}
 *          `text` is WhatsApp markup, ready to be the composer's draft.
 */
export function resolveTemplateBody(bodyHtml, ctx, lang = 'he') {
  // Same two steps as the canonical WhatsApp render path: chips/HTML → markup,
  // then token substitution over the plain text.
  const markup = htmlToWhatsApp(bodyHtml || '');
  if (!markup.trim()) return { text: '', values: {}, missing: [], unknown: [] };

  const referenced = [...new Set(extractTokens(markup))];
  // Fold aliases onto their canonical key before resolving.
  const canonical = [...new Set(referenced.map(canonicalTemplateKey))];
  // strictLanguage: the operator picked the language this message is written in,
  // so the greeting must carry the name recorded FOR that language or none at
  // all — "Hi," is correct, "Hi דוד," is not. Combined with the empty-fill policy
  // below, a name in the wrong script can never reach a customer.
  const { values, missing, unknown } = resolveVariables(canonical, ctx, lang, { strictLanguage: true });

  // Substitution map that also answers to the alias spelling, and turns every
  // missing/unknown value into '' so no raw {{token}} can survive.
  const fill = {};
  for (const key of referenced) {
    const c = canonicalTemplateKey(key);
    fill[key] = values[c] ?? '';
  }
  const substituted = substituteTokens(markup, fill);
  const hadEmpty = referenced.some((k) => !fill[k]);

  return {
    text: hadEmpty ? normalizeAfterEmptyFill(substituted) : substituted,
    values,
    missing,
    unknown,
  };
}
