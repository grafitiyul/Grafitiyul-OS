// Ingress adapter — WooCommerce (multi-store).
//
// ONE adapter serves both the existing site and the new one. The store is a
// parameter (`storeKey`), never a branch: identical translation, identical
// business meaning, separate credentials and separate idempotency namespace.
// Adding a third store is a config entry, not code.
//
// Delivery: Woo's native webhook POSTs the full order JSON. The legacy Make
// automation instead received only an id and fetched the order back, so we
// support both shapes — if the payload is not a complete order we fetch it via
// the REST API. That also makes replay work when only an id was captured.

import { buildEvent } from '../contract.js';
import { wooStoreConfig } from '../config.js';
import { verifyWooSignature } from '../signature.js';
import { ingressError, STAGES } from '../errors.js';

export const SOURCE = 'woocommerce';

export function verify({ rawBody, headers, storeKey }) {
  const cfg = wooStoreConfig(storeKey);
  if (!cfg) throw ingressError('store_unknown', { stage: STAGES.VALIDATE });
  verifyWooSignature({
    rawBody,
    header: headers?.['x-wc-webhook-signature'] || headers?.['X-WC-Webhook-Signature'],
    secret: cfg.webhookSecret,
  });
  return true;
}

// A payload is "complete" when it carries the customer and the lines; anything
// less (Woo's `{id: N}` ping, or a legacy id-only post) needs a fetch.
export function isCompleteOrder(payload) {
  return Boolean(payload && (payload.billing || payload.line_items) && payload.id);
}

export function orderIdOf(payload) {
  const raw = payload?.id ?? payload?.order_id ?? payload?.resource_id;
  return raw === undefined || raw === null || raw === '' ? null : String(raw);
}

// REST fetch, injectable for tests. Basic auth over HTTPS is WooCommerce's
// documented scheme for server-to-server reads.
export async function fetchOrder(storeKey, orderId, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = wooStoreConfig(storeKey);
  if (!cfg || !cfg.baseUrl || !cfg.consumerKey || !cfg.consumerSecret) {
    throw ingressError('store_unknown', { stage: STAGES.NORMALIZE, detail: `store ${storeKey} not configured` });
  }
  const url = `${cfg.baseUrl}/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}`;
  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}` } });
  } catch (err) {
    throw ingressError('provider_unreachable', { stage: STAGES.NORMALIZE, cause: err });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw ingressError(permanent ? 'provider_rejected' : 'provider_unavailable', {
      stage: STAGES.NORMALIZE,
      retryable: !permanent,
      detail: `HTTP ${res.status} ${String(body).slice(0, 200)}`,
    });
  }
  return res.json();
}

// Woo stores arbitrary extras in meta_data; the live store keeps the tour date
// under `_billing_tour_date` (discovered in the legacy blueprint).
export function metaValue(order, key) {
  const hit = (order?.meta_data || []).find((m) => m?.key === key);
  return hit?.value ?? null;
}

// Woo statuses that represent a real, revenue-bearing purchase. `pending` is
// deliberately EXCLUDED — those are abandoned carts, which the platform treats
// as leads through a different path, not as orders.
export const PAID_STATUSES = Object.freeze(['processing', 'completed', 'on-hold']);

export function isPaidStatus(status) {
  return PAID_STATUSES.includes(String(status || '').toLowerCase());
}

// Israeli dd/mm/yyyy is what the live store writes; ISO is what a modern store
// would. Accept both rather than assuming.
export function parseTourDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const il = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (il) return new Date(Number(il[3]), Number(il[2]) - 1, Number(il[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toCanonicalEvent(order, { storeKey }) {
  const b = order?.billing || {};
  const items = (order?.line_items || []).map((li) => ({
    sku: li.sku || null,
    name: li.name || null,
    quantity: li.quantity ?? 1,
    unitPrice: li.price ?? null,
    // variation_id when present identifies the exact purchased variant.
    externalId: li.variation_id ? String(li.variation_id) : li.product_id ? String(li.product_id) : null,
  }));

  return buildEvent({
    kind: 'order',
    source: SOURCE,
    sourceKey: storeKey,
    externalId: orderIdOf(order),
    occurredAt: order?.date_created ? new Date(order.date_created) : null,
    person: {
      firstName: b.first_name || null,
      lastName: b.last_name || null,
      email: b.email || null,
      phone: b.phone || null,
    },
    organization: b.company ? { name: b.company } : null,
    order: {
      total: order?.total ?? null,
      currency: order?.currency || null,
      status: order?.status || null,
      paid: isPaidStatus(order?.status),
      items,
    },
    context: {
      pageUrl: null,
      message: order?.customer_note || null,
      preferredDate: parseTourDate(metaValue(order, '_billing_tour_date')),
      formName: null,
    },
    attributionInput: {
      // Woo does not forward UTM by default; when a store plugin records them
      // in meta_data we honour them, otherwise the channel resolves to 'אתר'.
      utm: {
        utm_source: metaValue(order, '_utm_source') || undefined,
        utm_medium: metaValue(order, '_utm_medium') || undefined,
        utm_campaign: metaValue(order, '_utm_campaign') || undefined,
      },
    },
    extra: {
      orderNumber: order?.number || null,
      paymentMethod: order?.payment_method_title || order?.payment_method || null,
      storeKey,
      couponLines: (order?.coupon_lines || []).map((c) => c.code).filter(Boolean),
    },
  });
}

export const wooAdapter = Object.freeze({
  key: SOURCE,
  label: 'WooCommerce',
  verify,
  isCompleteOrder,
  orderIdOf,
  fetchOrder,
  toCanonicalEvent,
  isPaidStatus,
});
