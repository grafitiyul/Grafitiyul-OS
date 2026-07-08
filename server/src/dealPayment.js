import crypto from 'node:crypto';
import { generateSale, isIcountConfigured } from './icount.js';

// Deal payment-link domain logic, shared by the admin API (routes/deals.js)
// and the public /pay/:token redirect (routes/pay.js).
//
// Model: the customer only ever gets the PERMANENT GOS URL
// (${PUBLIC_ORIGIN}/pay/<Deal.paymentToken>). Opening it resolves the deal and
// redirects to the CURRENT iCount link — reusing the active one when the
// payment data it was generated from is unchanged, and regenerating (supersede
// + insert, history kept) only when it drifted. Nothing here ever touches deal
// status / paid state.
//
// Required vs optional (verified against the proven Challenge System call):
// generate_sale always needs items[] with description + unitprice_incl, so a
// positive amount is REQUIRED (productName always exists — Deal.title
// fallback). client_name / first/last / email / phone are sent as empty
// strings when missing and iCount accepts that — the customer fills them on
// the payment page — so contact details are OPTIONAL.

export function newPaymentToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Public origin for customer-facing URLs: PUBLIC_ORIGIN env when set (survives
// domain moves with no DB change), else derived from the request. No
// `trust proxy` is configured, so read x-forwarded-proto directly (Railway).
export function resolvePublicOrigin(req) {
  const env = String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  if (env) return env;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

export function paymentUrlFor(req, token) {
  // Canonical provider-visible URL. Old /pay/<token> links keep working via a
  // 301 redirect (routes/pay.js → /payment/icount/<token>).
  return `${resolvePublicOrigin(req)}/payment/icount/${token}`;
}

// Prefill contact: the first contact flagged to receive payment links, else
// the primary/first contact (contacts must be ordered isPrimary-first).
export function pickPaymentContact(contacts) {
  const list = contacts || [];
  return list.find((dc) => dc.receivePaymentLinks) || list[0] || null;
}

// What a link generated NOW would be built from — the fields that make an
// existing iCount link stale when they drift.
//
// customerName is the iCount document/customer DISPLAY name: the Deal's
// ORGANIZATION when linked (businesses invoice the org, not the person),
// else the contact's full name. first/last stay the CONTACT person's — they
// prefill the form fields the payer fills in.
export function buildPaymentSnapshot(deal) {
  const c = pickPaymentContact(deal.contacts)?.contact || null;
  const firstName = c ? c.firstNameHe || c.firstNameEn || '' : '';
  const lastName = c ? c.lastNameHe || c.lastNameEn || '' : '';
  return {
    amountMinor: deal.valueMinor ?? 0n,
    currency: deal.currency || 'ILS',
    productName: deal.product?.nameHe || deal.title,
    firstName,
    lastName,
    customerName:
      deal.organization?.name || [firstName, lastName].filter(Boolean).join(' ') || null,
    customerPhone: c?.phones?.[0]?.value || null,
    customerEmail: c?.emails?.[0]?.value || null,
  };
}

export function linkMatchesSnapshot(link, snap) {
  if (!link) return false;
  return (
    BigInt(link.amountMinor) === BigInt(snap.amountMinor) &&
    link.currency === snap.currency &&
    link.productName === snap.productName &&
    (link.customerName || null) === (snap.customerName || null) &&
    (link.customerPhone || null) === (snap.customerPhone || null) &&
    (link.customerEmail || null) === (snap.customerEmail || null)
  );
}

// Everything ensureCurrentIcountLink needs on the deal row.
export const PAYMENT_DEAL_INCLUDE = {
  product: { select: { nameHe: true } },
  organization: { select: { name: true } },
  contacts: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: {
      contact: {
        select: {
          firstNameHe: true,
          lastNameHe: true,
          firstNameEn: true,
          lastNameEn: true,
          phones: { where: { isPrimary: true }, take: 1 },
          emails: { where: { isPrimary: true }, take: 1 },
        },
      },
    },
  },
  paymentLinks: { where: { status: 'created' }, orderBy: { createdAt: 'desc' }, take: 1 },
};

function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

// Ensure the deal has its permanent token; returns it. Lazy: created on first
// use, then never changes (the customer URL must stay stable forever).
export async function ensurePaymentToken(prisma, deal) {
  if (deal.paymentToken) return deal.paymentToken;
  const token = newPaymentToken();
  await prisma.deal.update({ where: { id: deal.id }, data: { paymentToken: token } });
  return token;
}

// Return the deal's CURRENT iCount link: the active one when its snapshot
// still matches the deal, else generate a fresh one (previous row superseded,
// history kept). `deal` must be loaded with PAYMENT_DEAL_INCLUDE.
// Throws coded errors: amount_missing / icount_not_configured /
// icount_paypage_not_configured / icount_generate_failed.
export async function ensureCurrentIcountLink(prisma, deal, { createdBy } = {}) {
  const snap = buildPaymentSnapshot(deal);
  if (snap.amountMinor <= 0n) throw codedError('amount_missing');
  if (!snap.productName) throw codedError('product_missing');

  const active = deal.paymentLinks?.[0] || null;
  if (linkMatchesSnapshot(active, snap)) return active;

  if (!isIcountConfigured()) throw codedError('icount_not_configured');
  const paypageId = process.env.ICOUNT_DEFAULT_PAYPAGE_ID;
  if (!paypageId) throw codedError('icount_paypage_not_configured');

  // IPN: only attached when the webhook receiver is configured. The receiver
  // logs raw payloads only (no state changes) — see routes/icountWebhook.js.
  const origin = String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  const secret = process.env.ICOUNT_WEBHOOK_SECRET;
  const ipnUrl =
    origin && secret
      ? `${origin}/api/webhooks/icount/${secret}?dealId=${encodeURIComponent(deal.id)}`
      : null;

  const { saleUrl, raw } = await generateSale({
    paypageId,
    items: [
      {
        quantity: 1,
        description: snap.productName,
        // iCount expects major units, VAT-INCLUSIVE (unitprice_incl).
        unitprice_incl: Number(snap.amountMinor) / 100,
      },
    ],
    clientName: snap.customerName || 'לקוח',
    firstName: snap.firstName,
    lastName: snap.lastName,
    email: snap.customerEmail,
    phone: snap.customerPhone,
    maxPayments: Number(process.env.ICOUNT_MAX_PAYMENTS) || 10,
    ipnUrl,
  });

  const [, created] = await prisma.$transaction([
    prisma.dealPaymentLink.updateMany({
      where: { dealId: deal.id, status: 'created' },
      data: { status: 'superseded' },
    }),
    prisma.dealPaymentLink.create({
      data: {
        dealId: deal.id,
        provider: 'icount',
        status: 'created',
        paymentLinkUrl: saleUrl,
        paypageId: String(paypageId),
        amountMinor: snap.amountMinor,
        currency: snap.currency,
        productName: snap.productName,
        customerName: snap.customerName,
        customerPhone: snap.customerPhone,
        customerEmail: snap.customerEmail,
        createdBy: createdBy || null,
        rawProviderResponse: raw ?? undefined,
      },
    }),
  ]);
  return created;
}

// ── Custom payment links ("קישור לתשלום מותאם אישית") ────────────────────────
// Same GOS-redirect architecture, different content: the iCount page is built
// from the link row's FROZEN custom description + amount (the customer asked
// for a different line on the document), while contact prefill still comes
// from the deal — the payment stays tied to the same deal (ipn dealId) and the
// regular /pay/<Deal.paymentToken> flow is untouched. The row never drifts, so
// the sale link is generated once and reused; regeneration happens only if the
// eager attempt at creation time failed.
export async function ensureCustomIcountLink(prisma, link, deal) {
  if (link.paymentLinkUrl) return link;

  if (!isIcountConfigured()) throw codedError('icount_not_configured');
  const paypageId = process.env.ICOUNT_DEFAULT_PAYPAGE_ID;
  if (!paypageId) throw codedError('icount_paypage_not_configured');

  const snap = buildPaymentSnapshot(deal);
  const origin = String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  const secret = process.env.ICOUNT_WEBHOOK_SECRET;
  const ipnUrl =
    origin && secret
      ? `${origin}/api/webhooks/icount/${secret}?dealId=${encodeURIComponent(deal.id)}&customLinkId=${encodeURIComponent(link.id)}`
      : null;

  const { saleUrl, raw } = await generateSale({
    paypageId,
    items: [
      {
        quantity: 1,
        description: link.description,
        // iCount expects major units, VAT-INCLUSIVE (unitprice_incl).
        unitprice_incl: Number(link.amountMinor) / 100,
      },
    ],
    clientName: snap.customerName || 'לקוח',
    firstName: snap.firstName,
    lastName: snap.lastName,
    email: snap.customerEmail,
    phone: snap.customerPhone,
    maxPayments: Number(process.env.ICOUNT_MAX_PAYMENTS) || 10,
    ipnUrl,
  });

  return prisma.dealCustomPaymentLink.update({
    where: { id: link.id },
    data: { paymentLinkUrl: saleUrl, rawProviderResponse: raw ?? undefined },
  });
}
