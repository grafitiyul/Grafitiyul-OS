// THE trigger-context loader — one include tree shared by the live delivery
// engine, the worker's pre-send re-resolution, and the preview/simulator
// routes, so preview can never disagree with actual sending behavior.
//
// Shape: { deal, contact, fieldContact, org, tour, payment, reservation,
// quoteDoc, owner, links } — every branch nullable; the variable registry and
// condition evaluator read ONLY from this object.
//
// `links` policy: origin comes from PUBLIC_ORIGIN; the personal payment URL is
// exposed only when the deal already carries its permanent paymentToken.
// `allowMint: true` (the delivery worker) lazily mints the token through the
// canonical dealPayment helper — read-only surfaces (preview / simulator)
// never mint, so a preview can never mutate a Deal.

import { prisma } from '../db.js';
import { dealCollection } from '../collection.js';
import { ensurePaymentToken } from '../dealPayment.js';
import { ADMIN_NAME_SELECT } from '../admin/displayName.js';

/** Public origin for customer-facing links built outside a request context. */
export function publicOrigin() {
  return String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '') || null;
}

const DEAL_INCLUDE = {
  organization: { include: { organizationType: true } },
  organizationType: true,
  organizationSubtype: true,
  organizationUnit: true,
  product: true,
  productVariant: true,
  location: true,
  dealSource: true,
  contacts: {
    include: { contact: { include: { phones: true, emails: true } } },
    orderBy: { isPrimary: 'desc' },
  },
  bookings: {
    where: { status: 'active' },
    include: {
      tourEvent: {
        include: {
          assignments: { include: { personRef: { include: { profile: true } } } },
          location: true,
          productVariant: true,
          product: true,
        },
      },
    },
  },
  reservationGroup: { select: { sessionId: true } },
};

function pickPrimary(list) {
  return (list || []).find((x) => x.isPrimary) || (list || [])[0] || null;
}

export function contactPhone(contact) {
  return pickPrimary(contact?.phones)?.value ?? null;
}
export function contactEmail(contact) {
  return pickPrimary(contact?.emails)?.value ?? null;
}
// `strictLanguage`: never substitute the other language's name (a Hebrew name in
// an English message is wrong, not a fallback). Off by default.
export function contactFullName(contact, lang = 'he', opts = undefined) {
  if (!contact) return null;
  const he = `${contact.firstNameHe || ''} ${contact.lastNameHe || ''}`.trim();
  const en = `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim();
  if (opts?.strictLanguage) return (lang === 'en' ? en : he) || null;
  return (lang === 'en' ? en || he : he || en) || null;
}

/** The canonical quote-document link resolution rule (documented):
 *  the NEWEST PRODUCED QuoteDocument of the deal's PRIMARY (first non-archived)
 *  offer. For WON deals the wonQuoteRef audit stamp wins — commercial
 *  immutability: the quote the win was based on, not "whatever is latest". */
async function resolveQuoteDoc(deal) {
  if (deal?.wonQuoteRef?.publicToken) {
    return {
      quoteDocumentId: deal.wonQuoteRef.quoteDocumentId || null,
      publicToken: deal.wonQuoteRef.publicToken,
      versionNo: deal.wonQuoteRef.versionNo ?? null,
      source: 'wonQuoteRef',
    };
  }
  const offer =
    (await prisma.quoteOffer.findFirst({
      where: { dealId: deal.id, archivedAt: null, isPrimary: true },
      select: { id: true },
    })) ||
    (await prisma.quoteOffer.findFirst({
      where: { dealId: deal.id, archivedAt: null },
      orderBy: { offerNo: 'asc' },
      select: { id: true },
    }));
  if (!offer) return null;
  const doc = await prisma.quoteDocument.findFirst({
    where: { offerId: offer.id, status: 'produced' },
    orderBy: { versionNo: 'desc' },
    select: { id: true, publicToken: true, versionNo: true },
  });
  return doc
    ? { quoteDocumentId: doc.id, publicToken: doc.publicToken, versionNo: doc.versionNo, source: 'latest_produced' }
    : null;
}

/**
 * Apply a trigger-carried payload onto a loaded context — the ONE place
 * trigger data augments/overrides context, used identically by the engine at
 * fire time, the worker at send time, and the simulator:
 *   - ctx.triggerData          — change payloads etc. for the variables.
 *   - explicit quote identity  — quote_send names a SPECIFIC immutable
 *     QuoteDocument; it overrides the default resolution rule so the exact
 *     chosen document is linked, frozen with the delivery.
 */
export function applyTriggerOverrides(ctx, triggerData) {
  if (!triggerData || typeof triggerData !== 'object') return ctx;
  ctx.triggerData = triggerData;
  if (triggerData.quoteDocumentId && triggerData.publicToken) {
    ctx.quoteDoc = {
      quoteDocumentId: triggerData.quoteDocumentId,
      publicToken: triggerData.publicToken,
      versionNo: triggerData.versionNo ?? null,
      source: 'explicit_action',
    };
  }
  return ctx;
}

/**
 * Load the full context for a trigger payload: { dealId?, sessionId?,
 * tourEventId? }. At least one id is required.
 */
export async function loadTriggerContext(
  { dealId = null, sessionId = null, tourEventId = null } = {},
  { allowMint = false } = {},
) {
  let deal = null;
  if (dealId) {
    deal = await prisma.deal.findUnique({ where: { id: dealId }, include: DEAL_INCLUDE });
  }

  // Reservation context — explicit session, or derived from the deal's group.
  let reservation = null;
  const sid = sessionId || deal?.reservationGroup?.sessionId || null;
  if (sid) {
    const session = await prisma.reservationSession.findUnique({
      where: { id: sid },
      include: {
        contact: { include: { phones: true, emails: true } },
        organization: { include: { organizationType: true } },
        document: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, language: true } },
        groups: { select: { id: true, createdDealId: true, groupName: true } },
      },
    });
    if (session) reservation = session;
  }

  // Tour: explicit id, else the deal's active booking.
  let tour = null;
  if (tourEventId) {
    tour = await prisma.tourEvent.findUnique({
      where: { id: tourEventId },
      include: {
        assignments: { include: { personRef: { include: { profile: true } } } },
        location: true,
        productVariant: true,
        product: true,
      },
    });
  } else if (deal?.bookings?.length) {
    tour = deal.bookings[0].tourEvent;
  }

  const primaryDc = deal ? pickPrimary(deal.contacts) : null;
  const fieldDc = deal
    ? (deal.contacts || []).find((dc) => Array.isArray(dc.roles) && dc.roles.includes('fieldRep')) || null
    : null;
  const contact = primaryDc?.contact || reservation?.contact || null;

  const payment = deal ? await dealCollection(prisma, deal) : null;
  const quoteDoc = deal ? await resolveQuoteDoc(deal) : null;

  // Deal owner — resolved through the canonical admin display-name contract
  // (ADMIN_NAME_SELECT keeps displayName+username travelling together). The
  // shape stays a list-ready single ref so a future multi-owner model extends
  // it without breaking variables. No owner ⇒ null (honest missing value).
  const owner = deal?.ownerUserId
    ? await prisma.adminUser.findUnique({ where: { id: deal.ownerUserId }, select: ADMIN_NAME_SELECT })
    : null;

  // Canonical customer-facing links. Payment token is exposed as-is; the
  // worker (allowMint) lazily mints the permanent token via the canonical
  // helper — preview/simulator stay strictly read-only.
  const origin = publicOrigin();
  let paymentToken = deal?.paymentToken || null;
  if (!paymentToken && allowMint && deal) {
    try {
      paymentToken = await ensurePaymentToken(prisma, deal);
    } catch { /* payment link stays a missing value */ }
  }
  const links = {
    origin,
    paymentUrl: origin && paymentToken ? `${origin}/payment/icount/${paymentToken}` : null,
  };

  return {
    deal,
    contact,
    fieldContact: fieldDc?.contact || null,
    org: deal?.organization || reservation?.organization || null,
    tour,
    payment,
    reservation,
    quoteDoc,
    owner,
    links,
  };
}
