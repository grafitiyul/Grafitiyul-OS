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

import crypto from 'node:crypto';
import { buildEvent } from '../contract.js';
import { wooStoreConfig } from '../config.js';
import { verifyWooSignature } from '../signature.js';
import { ingressError, STAGES } from '../errors.js';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 40);

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

// WooCommerce's webhook-creation ping (WC_Webhook::deliver_ping) POSTs the
// form body `webhook_id=<id>` with NO X-WC-Webhook-Signature header, and
// requires exactly HTTP 200 — anything else surfaces "Delivery URL returned
// response code: NNN" in wp-admin and leaves the webhook stuck in pending
// delivery. The ping cannot be HMAC-verified (Woo signs only real deliveries),
// so the ONE unauthenticated shape we acknowledge is exactly that documented
// body with no signature header — and acknowledging performs NO work: nothing
// is fetched, ingested or written, so a forged ping gains nothing. A signed
// request never reaches this path, and any other unsigned request still 401s.
export function isWebhookPing({ rawBody, headers }) {
  const signed = headers?.['x-wc-webhook-signature'] || headers?.['X-WC-Webhook-Signature'];
  if (signed) return false;
  const body = rawBody == null ? '' : String(rawBody);
  return /^webhook_id=\d+$/.test(body.trim());
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

// Woo statuses that represent money actually received.
//
// 'on-hold' was here until 2026-08-04 and is deliberately NOT any more: Woo uses
// it for "awaiting payment / awaiting confirmation" (bank transfer, cheque,
// manual review), which is precisely NOT paid. Treating it as paid is what would
// drive the canonical WON transition — and all of its effects, including a
// confirmation email to the customer — off an order nobody has paid for.
//
// A non-paid status NEVER means "drop the event": every Woo order reaches GOS
// and becomes a Deal. Paid only decides whether the deal WINS.
export const PAID_STATUSES = Object.freeze(['processing', 'completed']);

export function isPaidStatus(status) {
  return PAID_STATUSES.includes(normalizeStatus(status));
}

export function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase().replace(/^wc-/, '');
}

// THE operator-facing meaning of each Woo status. One catalogue, so the pinned
// note, the timeline entry and any future surface all say the same thing.
// `known:false` marks a status a plugin invented — reported verbatim rather
// than silently bucketed as something it may not be.
const STATUS_MEANING = Object.freeze({
  pending: { icon: '🛒', title: 'התחיל הזמנה ולא השלים תשלום', detail: 'הלקוח התחיל תהליך הזמנה באתר אך לא השלים את התשלום.' },
  'checkout-draft': { icon: '🛒', title: 'טיוטת תשלום שלא הושלמה', detail: 'נפתחה טיוטת הזמנה בקופה ולא הושלמה.' },
  failed: { icon: '❌', title: 'התשלום נכשל', detail: 'ניסיון התשלום נכשל או נדחה.' },
  'on-hold': { icon: '⏳', title: 'ממתין לתשלום או לאישור', detail: 'ההזמנה ממתינה לתשלום/אישור (למשל העברה בנקאית).' },
  processing: { icon: '✅', title: 'התשלום התקבל', detail: 'התשלום התקבל וההזמנה בטיפול.' },
  completed: { icon: '✅', title: 'ההזמנה הושלמה', detail: 'ההזמנה שולמה והושלמה.' },
  cancelled: { icon: '🚫', title: 'ההזמנה בוטלה', detail: 'ההזמנה בוטלה באתר.' },
  refunded: { icon: '↩️', title: 'ההזמנה זוכתה — לטיפול המשרד', detail: 'בוצע זיכוי על ההזמנה. סטטוס הדיל לא שונה אוטומטית.' },
  trash: { icon: '🗑', title: 'ההזמנה הועברה לאשפה בווקומרס', detail: 'ההזמנה הועברה לאשפה בחנות. סטטוס הדיל לא שונה אוטומטית.' },
});

export function statusMeaning(status) {
  const key = normalizeStatus(status);
  const hit = STATUS_MEANING[key];
  if (hit) return { ...hit, status: key, known: true };
  return {
    icon: '⚠️',
    title: `סטטוס הזמנה לא מוכר: ${key || '—'}`,
    detail: 'הסטטוס הזה אינו מוכר למערכת. ההזמנה נשמרה כמו שהיא — יש לבדוק ידנית.',
    status: key,
    known: false,
  };
}

// THE event identity of one Woo delivery — a hash over the fields that carry
// business meaning, deliberately NOT the raw body.
//
// Why a projection and not the raw payload: Woo stamps `date_modified` on every
// save, so a raw-body hash would mint a brand-new event for a no-op edit and
// spray meaningless entries across the deal timeline. Why not the order id
// alone (the rule until 2026-08-04): that collapsed every status transition
// onto the first delivery, so pending → processing → completed silently froze
// the deal at `pending`.
//
// Why not Woo's x-wc-webhook-delivery-id: WooCommerce mints a NEW delivery id
// for every delivery attempt, so a retry would carry a different id and be
// processed a second time — the exact opposite of an idempotency key.
//
// The projection therefore contains everything a change to which should update
// the deal, and nothing else:
//   identical retry / no-op save → same hash → duplicate, nothing happens
//   status transition           → new hash  → the SAME deal is updated
//   date/product/participant/customer edit → new hash → the SAME deal is updated
export function wooEventProjection(order) {
  const b = order?.billing || {};
  return {
    id: orderIdOf(order),
    status: normalizeStatus(order?.status),
    total: order?.total ?? null,
    currency: order?.currency || null,
    paymentMethod: order?.payment_method_title || order?.payment_method || null,
    customerNote: order?.customer_note || null,
    tourDate: metaValue(order, '_billing_tour_date'),
    billing: {
      firstName: b.first_name || null,
      lastName: b.last_name || null,
      email: b.email || null,
      phone: b.phone || null,
      company: b.company || null,
    },
    items: (order?.line_items || [])
      .map((li) => ({
        productId: li.product_id ?? null,
        variationId: li.variation_id ?? null,
        name: li.name || null,
        sku: li.sku || null,
        quantity: li.quantity ?? 1,
        total: li.total ?? li.price ?? null,
      }))
      // Woo does not guarantee line order across saves; sort so a reordered
      // payload is not mistaken for a real edit.
      .sort((x, y) => String(x.productId ?? '').localeCompare(String(y.productId ?? ''))
        || String(x.variationId ?? '').localeCompare(String(y.variationId ?? ''))),
    coupons: (order?.coupon_lines || []).map((c) => c.code).filter(Boolean).sort(),
  };
}

export function wooEventHash(order) {
  return sha256(JSON.stringify(wooEventProjection(order)));
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

// Total units ordered across all line items. Null when Woo sent no lines, so
// "unknown" stays distinguishable from a real zero.
export function orderedQuantity(order) {
  const items = order?.line_items || [];
  if (!items.length) return null;
  const total = items.reduce((sum, li) => sum + (Number(li?.quantity) || 0), 0);
  return total > 0 ? total : null;
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
      // Participants = the ordered quantity. For a tour product the quantity IS
      // the head count — that is what the customer bought and what Woo knows.
      // Null when there are no line items, never a guessed default.
      participants: orderedQuantity(order),
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
      // Everything the status note renders. Only what Woo actually sent — a
      // field the payload does not carry stays null and is shown as unknown,
      // never invented.
      wooStatus: normalizeStatus(order?.status),
      dateCreated: order?.date_created || null,
      dateModified: order?.date_modified || null,
      datePaid: order?.date_paid || null,
      dateCompleted: order?.date_completed || null,
      discountTotal: order?.discount_total ?? null,
      shippingTotal: order?.shipping_total ?? null,
      totalTax: order?.total_tax ?? null,
      transactionId: order?.transaction_id || null,
      customerId: order?.customer_id ?? null,
      customerIp: order?.customer_ip_address || null,
      orderKey: order?.order_key || null,
      createdVia: order?.created_via || null,
      // Line items with the detail an operator reads (variant + per-line total).
      lineItems: (order?.line_items || []).map((li) => ({
        name: li.name || null,
        sku: li.sku || null,
        quantity: li.quantity ?? 1,
        total: li.total ?? null,
        productId: li.product_id ?? null,
        variationId: li.variation_id ?? null,
        // Woo variation attributes ("סוג סיור: קבוצתי") when present.
        //
        // Woo exposes these under both `key`/`value` and the human-facing
        // `display_key`/`display_value`, and not every entry carries both.
        // Read either, and hide only Woo's internal `_`-prefixed keys — keying
        // the filter on `key` alone silently dropped display-only attributes.
        meta: (li.meta_data || [])
          .map((m) => ({
            key: m?.display_key || m?.key || null,
            value: m?.display_value ?? m?.value ?? null,
            internal: String(m?.key || '').startsWith('_'),
          }))
          .filter((m) => m.key && !m.internal && m.value !== null && String(m.value).trim() !== '')
          .map(({ key, value }) => ({ key, value })),
      })),
      feeLines: (order?.fee_lines || []).map((f) => ({ name: f.name || null, total: f.total ?? null })),
    },
  });
}

export const wooAdapter = Object.freeze({
  key: SOURCE,
  label: 'WooCommerce',
  verify,
  isWebhookPing,
  isCompleteOrder,
  orderIdOf,
  fetchOrder,
  toCanonicalEvent,
  isPaidStatus,
  normalizeStatus,
  statusMeaning,
  wooEventHash,
});
