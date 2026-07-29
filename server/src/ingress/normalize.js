// Ingress Platform — THE normalization layer.
//
// Turns a validated canonical event into the normalized form the rest of the
// pipeline (dedupe, identity resolution, record creation) consumes. Every
// source goes through this exact code — that is the whole point: an Elementor
// form and a Meta lead must produce identical normalized output for the same
// human.
//
// Phone normalization deliberately REUSES `normalizePhoneIntl` from the
// WhatsApp module, which is already declared THE canonical phone normalizer for
// GOS. Re-implementing it here would create a second notion of "same number"
// and split contact matching between modules — exactly what the architecture
// forbids. The import direction is intentional: ingress depends on the shared
// normalizer, not on anything WhatsApp-specific.

import { normalizePhoneIntl } from '../whatsapp/phone.js';
import { resolveAttribution } from './attribution.js';

const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

// Email: lowercase + trim. No aggressive canonicalization (dots, plus-tags) —
// two addresses that differ are treated as different people, which is the safe
// direction for a CRM.
export function normalizeEmail(raw) {
  const s = clean(raw);
  if (!s) return null;
  const lower = s.toLowerCase();
  // Minimal shape check — anything without a single @ and a dotted domain is
  // not usable for matching or contact creation.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
  return lower;
}

// Israeli-first display form for a stored ContactPhone: local 0-prefixed when
// the number is Israeli, otherwise +international. GOS stores phones as typed,
// so this is what a human would have entered.
export function displayPhone(intl) {
  if (!intl) return null;
  if (intl.startsWith('972')) return `0${intl.slice(3)}`;
  return `+${intl}`;
}

// Name splitting. Providers give either a single full name (Meta, Elementor) or
// separate parts (WooCommerce billing). One rule, applied everywhere: first
// token is the first name, the remainder is the last name.
export function splitName({ fullName, firstName, lastName }) {
  const f = clean(firstName);
  const l = clean(lastName);
  if (f || l) return { firstName: f || '', lastName: l || '' };
  const full = clean(fullName);
  if (!full) return { firstName: '', lastName: '' };
  const tokens = full.split(' ');
  return { firstName: tokens[0], lastName: tokens.slice(1).join(' ') };
}

// Best-effort date coercion. Never throws — an unparseable date is simply null
// rather than a failed lead.
export function coerceDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Strips currency symbols and thousands separators. Deliberately returns null
// (not 0) when the input carries no digits at all — a stray label like "N/A"
// must never become a zero-priced order line.
export function coerceNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const stripped = String(v).replace(/[^\d.-]/g, '');
  if (!/\d/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

export function normalizeEvent(event) {
  const phoneIntl = normalizePhoneIntl(event?.person?.phone);
  const email = normalizeEmail(event?.person?.email);
  const { firstName, lastName } = splitName(event?.person || {});

  return {
    kind: event.kind,
    source: event.source,
    sourceKey: event.sourceKey ?? null,
    externalId: event.externalId ?? null,
    occurredAt: coerceDate(event.occurredAt),

    person: {
      firstName,
      lastName,
      displayName: clean([firstName, lastName].filter(Boolean).join(' ')) || clean(event?.person?.fullName),
      email,
      // Both forms are kept: `phoneIntl` is the ONLY value used for matching;
      // `phoneDisplay` is what gets written onto a new ContactPhone.
      phoneIntl,
      phoneDisplay: displayPhone(phoneIntl),
      language: clean(event?.person?.language),
    },

    organization: event.organization?.name
      ? { name: clean(event.organization.name), taxId: clean(event.organization.taxId) }
      : null,

    order: event.order
      ? {
          total: coerceNumber(event.order.total),
          currency: clean(event.order.currency) || 'ILS',
          status: clean(event.order.status),
          paid: event.order.paid === null || event.order.paid === undefined ? null : Boolean(event.order.paid),
          items: (event.order.items || []).map((it) => ({
            sku: clean(it.sku),
            name: clean(it.name),
            quantity: coerceNumber(it.quantity) ?? 1,
            unitPrice: coerceNumber(it.unitPrice),
            externalId: clean(it.externalId),
          })),
        }
      : null,

    context: {
      pageUrl: clean(event.context?.pageUrl),
      referrer: clean(event.context?.referrer),
      formName: clean(event.context?.formName),
      message: clean(event.context?.message),
      interestedIn: clean(event.context?.interestedIn),
      participants: coerceNumber(event.context?.participants),
      preferredDate: coerceDate(event.context?.preferredDate),
      // Whitespace-cleaned but otherwise untouched: order is preserved, no
      // entry is dropped, and `answered` keeps the blank-vs-never-asked
      // distinction that `value` alone cannot express.
      formAnswers: (event.context?.formAnswers || []).map((a) => {
        const value = clean(a?.value);
        return {
          key: clean(a?.key),
          label: clean(a?.label) || clean(a?.key),
          value,
          answered: Boolean(a?.answered) && value !== null,
        };
      }),
    },

    attribution: resolveAttribution(event),
    extra: event.extra || {},
  };
}
