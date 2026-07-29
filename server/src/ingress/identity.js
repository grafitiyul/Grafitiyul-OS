// Ingress Platform — THE idempotency + deduplication layer.
//
// Two distinct concepts, deliberately kept apart because they answer different
// questions and have different consequences:
//
//   idempotencyKey (transport)  "have I already RECEIVED this exact delivery?"
//       Scope: (source, key), enforced by a unique index. A provider retry, a
//       double-submit or a replay collapses onto the same IngressEvent row.
//       Consequence: the second delivery is recorded as `duplicate` and does
//       nothing at all.
//
//   dedupeKey (business)        "is this the same PERSON as a recent lead?"
//       Scope: normalized phone (preferred) or email. Consequence: the pipeline
//       annotates the existing deal instead of creating a second one — the same
//       decision the legacy automation made with its "הליד פנה בעבר" note.
//
// Both are computed here so no adapter can invent its own rule.

import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 40);

// Transport-level key. An adapter SHOULD supply a provider-stable id (leadgen
// id, order id); when it cannot, we hash the raw body so at least byte-identical
// re-deliveries collapse. `salt` lets a source add a discriminator (e.g. store
// key) without colliding across instances.
export function buildIdempotencyKey({ source, sourceKey, externalId, rawBody, salt = null }) {
  const parts = [source || 'unknown', sourceKey || '-', salt || '-'];
  if (externalId) {
    parts.push(`id:${externalId}`);
  } else {
    parts.push(`body:${sha(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? ''))}`);
  }
  return parts.join('|');
}

// Business-level key. Phone wins over email because a phone identifies a person
// far more reliably in this business (shared family inboxes are common, shared
// mobiles are not) — and it mirrors the legacy pipeline, which searched by
// phone first and only fell back to email when the phone was unusable.
export function buildDedupeKey(normalized) {
  const phone = normalized?.person?.phoneIntl;
  if (phone) return `p:${phone}`;
  const email = normalized?.person?.email;
  if (email) return `e:${email}`;
  return null;
}

// How long a prior lead from the same person suppresses creating a new deal.
// 30 days matches the legacy "לוסט לדיל לאחר 30 יום" cadence — inside the
// window it is the same conversation; outside it, it is genuinely new interest.
export const DEDUPE_WINDOW_DAYS = 30;

export function dedupeWindowStart(now = new Date(), days = DEDUPE_WINDOW_DAYS) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// Decision record produced by the pipeline's dedupe stage. Pure — the caller
// supplies what it found in the database, this decides what it means.
//
// Orders are NEVER suppressed: a second purchase by the same person is a second
// piece of revenue, not a duplicate lead. Only `lead` events dedupe.
export function decideDedupe({ kind, priorEvent, priorDealId }) {
  if (kind === 'order') return { action: 'create', reason: 'orders_never_dedupe' };
  if (priorDealId) return { action: 'annotate', reason: 'recent_open_deal', dealId: priorDealId };
  if (priorEvent) return { action: 'annotate', reason: 'recent_lead', dealId: priorEvent.dealId || null };
  return { action: 'create', reason: 'no_recent_activity' };
}
