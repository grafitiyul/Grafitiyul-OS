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

// Variables this feature actually supports. Deliberately narrow: the registry
// can resolve far more, but a template may only reference what this slice has
// specified and verified. Widening = add a key here (plus its registry entry if
// it is genuinely new) — never an ad-hoc substitution somewhere else.
export const TEMPLATE_VARIABLE_KEYS = ['customer_first_name'];

// Aliases accepted on INPUT only (never stored, never offered in the picker).
// 'first_name' is already taken in the client dynamic-field registry for the
// EMPLOYEE first name (learning module), so the customer's first name stays
// {{customer_first_name}} — but a hand-typed {{first_name}} inside a WhatsApp
// template still resolves to the customer rather than leaking as raw text.
const KEY_ALIASES = { first_name: 'customer_first_name' };

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

/** The picker/menu list for the settings editor (label comes from the registry). */
export function templateVariables() {
  return TEMPLATE_VARIABLE_KEYS.map((key) => {
    const def = variableByKey(key);
    return {
      key,
      labelHe: def?.labelHe || key,
      labelEn: def?.labelEn || key,
      category: def?.category || 'customer',
      descriptionHe: VARIABLE_HELP_HE[key] || null,
    };
  });
}

/**
 * Tokens in `html` that this feature does not support — used to reject a body
 * at SAVE time so an unresolvable token can never reach a customer at all.
 * Recognized aliases count as supported.
 */
export function unsupportedTokens(html) {
  const allowed = new Set(TEMPLATE_VARIABLE_KEYS);
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
