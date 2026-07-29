// Ingress Platform — THE canonical event contract.
//
// This is the ONE shape every adapter must produce and the ONE shape the
// pipeline consumes. Adapters translate; they never interpret. If a field is
// not in this contract, no adapter may invent it — the contract grows here,
// deliberately, for everyone at once.
//
// The contract is intentionally source-blind: nothing in it names Meta,
// WooCommerce or Elementor. Source identity travels in `source`/`sourceKey`,
// and anything genuinely provider-specific goes in `raw` (kept for audit) or
// `extra` (kept for display), never as a first-class business field.

import { ingressError, STAGES } from './errors.js';

// The kinds of business event the platform understands. `lead` and `order` are
// the two approved for this phase; the enum exists so a future source declares
// its intent instead of the pipeline guessing.
export const EVENT_KINDS = Object.freeze(['lead', 'order']);

/**
 * The canonical ingress event.
 *
 * {
 *   kind:        'lead' | 'order'
 *   source:      adapter key            e.g. 'meta_lead_ads'
 *   sourceKey:   instance within source e.g. 'primary' | 'contact_page' | page id
 *   externalId:  provider's own id      e.g. leadgen id / Woo order id
 *   occurredAt:  Date | null            when the provider says it happened
 *   person: { fullName, firstName, lastName, email, phone, language }
 *   organization: { name, taxId } | null
 *   order: { total, currency, items:[{ sku, name, quantity, unitPrice, externalId }],
 *            status, paid } | null
 *   context: { pageUrl, referrer, formName, message, interestedIn, participants,
 *              preferredDate, formAnswers }
 *
 * `formAnswers` is the COMPLETE, ordered set of question/answer pairs exactly as
 * the customer submitted them — including questions that map to no structured
 * GOS field. It is deliberately generic (Meta Lead Ads, Elementor, Cognito all
 * produce the same shape), so it lives in the contract rather than in `extra`.
 *
 * Each entry: { key, label, value, answered }
 *   - `value: null` + `answered: false`  → the question WAS asked and left blank
 *   - absent from the array entirely     → the question was never asked
 * That distinction is the whole reason `answered` exists as a separate flag
 * instead of being inferred from `value`.
 *   attributionInput: { url, utm:{...}, campaignName, adId, adsetId, campaignId }
 *   extra:  free-form display-only key/values
 * }
 */
export function buildEvent(input = {}) {
  return {
    kind: input.kind || 'lead',
    source: input.source || null,
    sourceKey: input.sourceKey ?? null,
    externalId: input.externalId ? String(input.externalId) : null,
    occurredAt: input.occurredAt instanceof Date ? input.occurredAt : null,
    person: {
      fullName: input.person?.fullName ?? null,
      firstName: input.person?.firstName ?? null,
      lastName: input.person?.lastName ?? null,
      email: input.person?.email ?? null,
      phone: input.person?.phone ?? null,
      language: input.person?.language ?? null,
    },
    organization: input.organization
      ? { name: input.organization.name ?? null, taxId: input.organization.taxId ?? null }
      : null,
    order: input.order
      ? {
          total: input.order.total ?? null,
          currency: input.order.currency ?? null,
          items: Array.isArray(input.order.items) ? input.order.items : [],
          status: input.order.status ?? null,
          paid: input.order.paid ?? null,
        }
      : null,
    context: {
      pageUrl: input.context?.pageUrl ?? null,
      referrer: input.context?.referrer ?? null,
      formName: input.context?.formName ?? null,
      message: input.context?.message ?? null,
      interestedIn: input.context?.interestedIn ?? null,
      participants: input.context?.participants ?? null,
      preferredDate: input.context?.preferredDate ?? null,
      // Never dropped, never reordered: the raw submission in the customer's
      // own words is what an operator reads first.
      formAnswers: Array.isArray(input.context?.formAnswers) ? input.context.formAnswers : [],
    },
    attributionInput: {
      url: input.attributionInput?.url ?? null,
      utm: input.attributionInput?.utm ?? null,
      campaignName: input.attributionInput?.campaignName ?? null,
      adId: input.attributionInput?.adId ?? null,
      adsetId: input.attributionInput?.adsetId ?? null,
      campaignId: input.attributionInput?.campaignId ?? null,
    },
    extra: input.extra && typeof input.extra === 'object' ? input.extra : {},
  };
}

// Structural validation only — "is this a well-formed contract object". It does
// NOT judge whether the lead is useful (that is the pipeline's identity check,
// which produces a different, more specific error).
export function validateEvent(event) {
  const problems = [];
  if (!event || typeof event !== 'object') {
    throw ingressError('contract_invalid', { stage: STAGES.VALIDATE, detail: 'event is not an object' });
  }
  if (!EVENT_KINDS.includes(event.kind)) problems.push(`kind must be one of ${EVENT_KINDS.join('|')}`);
  if (!event.source) problems.push('source is required');
  if (!event.person || typeof event.person !== 'object') problems.push('person is required');
  if (event.order && !Array.isArray(event.order.items)) problems.push('order.items must be an array');
  if (event.occurredAt && !(event.occurredAt instanceof Date)) problems.push('occurredAt must be a Date');

  if (problems.length) {
    throw ingressError('contract_invalid', { stage: STAGES.VALIDATE, detail: problems.join('; ') });
  }
  return true;
}

// A contract carries usable identity when we can reach the person at all.
// Without a phone or an email there is nothing to dedupe on and nothing to
// follow up with — the legacy automation emailed the office in this case, and
// the pipeline preserves that intent by failing with a specific code.
export function hasUsableIdentity(normalized) {
  return Boolean(normalized?.person?.phoneIntl || normalized?.person?.email);
}
