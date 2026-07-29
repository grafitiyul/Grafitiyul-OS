// Ingress adapter — website / Elementor forms.
//
// ONE adapter for every form on the site. The legacy automation had a separate
// six-module scenario per form, each re-implementing the same field guessing;
// here the form is identified by `formKey` and the differences are absorbed by
// one alias table.
//
// Field naming in the wild is genuinely messy — the live forms send Hebrew
// labels, Elementor's "No Label"/"אין תווית" placeholders, raw Elementor field
// ids (`field_e3e4b67`), and English names, sometimes several spellings in the
// same payload. Rather than branch per form, we resolve by alias and take the
// first non-empty match. Adding a form is a config line, not a new scenario.

import { buildEvent } from '../contract.js';
import { websiteFormConfig } from '../config.js';
import { verifyWebsiteFormAuth } from '../signature.js';

export const SOURCE = 'website_form';

// Known aliases per canonical field, ordered by preference.
const ALIASES = Object.freeze({
  fullName: ['name', 'full_name', 'fullname', 'שם', 'שם מלא', 'שם:', 'No Label name', 'אין תווית name'],
  firstName: ['first_name', 'firstname', 'שם פרטי'],
  lastName: ['last_name', 'lastname', 'שם משפחה'],
  phone: [
    'phone', 'tel', 'telephone', 'טלפון', 'טלפון:', 'נייד', 'נייד:', 'מספר טלפון',
    'field_e3e4b67', 'No Label field_e3e4b67', 'אין תווית field_e3e4b67',
  ],
  email: ['email', 'mail', 'e-mail', 'אימייל', 'מייל', 'מייל:', 'דואר אלקטרוני', 'No Label email', 'אין תווית email'],
  message: ['message', 'msg', 'הודעה', 'הערות', 'תוכן', 'הערות אם יש'],
  pageUrl: ['url', 'page_url', 'קישור לעמוד', 'referrer_url'],
  interestedIn: ['interestedIn', 'interested_in', 'מתעניין ב', 'סוג פעילות'],
  participants: ['participants', 'כמות משתתפים', 'מספר משתתפים', 'ועל כמה משתתפים מדובר?'],
  company: ['company', 'organization', 'חברה', 'ארגון', 'שם החברה'],
  preferredDate: ['date', 'תאריך', 'תאריך מבוקש'],
});

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Flatten one level of nesting: Elementor sometimes nests under `fields` or
// `form_fields`, and some plugins send `{ fields: { name: { value } } }`.
export function flattenPayload(payload) {
  const flat = {};
  const put = (k, v) => {
    if (k === undefined || k === null) return;
    if (v === undefined || v === null) return;
    if (typeof v === 'object') {
      if ('value' in v) return put(k, v.value);
      return; // deeper structures are not business fields
    }
    if (String(v).trim() === '') return;
    if (flat[norm(k)] === undefined) flat[norm(k)] = String(v).trim();
  };

  for (const [k, v] of Object.entries(payload || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (k === 'fields' || k === 'form_fields' || k === 'data')) {
      for (const [k2, v2] of Object.entries(v)) put(k2, v2);
    } else {
      put(k, v);
    }
  }
  return flat;
}

export function pick(flat, key) {
  for (const alias of ALIASES[key] || []) {
    const v = flat[norm(alias)];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

export function verify({ rawBody, headers, providedSecret }) {
  verifyWebsiteFormAuth({
    rawBody,
    providedSecret,
    signatureHeader: headers?.['x-gos-signature'] || headers?.['X-GOS-Signature'],
    secret: websiteFormConfig().secret,
  });
  return true;
}

/**
 * @param payload  the parsed form body
 * @param formKey  which form on the site (contact_page, footer, popup, …) —
 *                 carried through as sourceKey so attribution stays per-form
 */
export function toCanonicalEvent(payload, { formKey = null } = {}) {
  const flat = flattenPayload(payload);
  const pageUrl = pick(flat, 'pageUrl');

  return buildEvent({
    kind: 'lead',
    source: SOURCE,
    sourceKey: formKey,
    externalId: null, // website forms carry no provider id — body hash is the key
    occurredAt: null,
    person: {
      fullName: pick(flat, 'fullName'),
      firstName: pick(flat, 'firstName'),
      lastName: pick(flat, 'lastName'),
      email: pick(flat, 'email'),
      phone: pick(flat, 'phone'),
    },
    organization: pick(flat, 'company') ? { name: pick(flat, 'company') } : null,
    context: {
      pageUrl,
      referrer: flat[norm('referrer')] || null,
      formName: formKey,
      message: pick(flat, 'message'),
      interestedIn: pick(flat, 'interestedIn'),
      participants: pick(flat, 'participants'),
      preferredDate: pick(flat, 'preferredDate'),
    },
    // UTM is read off the submitted page URL by the shared resolver; explicit
    // utm_* fields in the body (some forms post them as hidden inputs) win.
    attributionInput: {
      url: pageUrl,
      utm: {
        utm_source: flat.utm_source,
        utm_medium: flat.utm_medium,
        utm_campaign: flat.utm_campaign,
        utm_content: flat.utm_content,
        utm_term: flat.utm_term,
      },
    },
    extra: { formKey },
  });
}

export const websiteFormAdapter = Object.freeze({
  key: SOURCE,
  label: 'טופס באתר',
  verify,
  toCanonicalEvent,
  flattenPayload,
});
