// Quote signed → Admin Report #9.
//
// Called from the ONE signing write path (quote/quoteSignature.js) right after
// its transaction commits, so any future caller of that service is covered by
// this single wiring. Exactly-once by construction: QuoteSignature.quoteDocumentId
// is unique, so a document can be signed only once — and the report keys on the
// document id, so even a replayed call cannot report twice.

import { prisma } from '../db.js';
import { fireAdminReport } from './dispatch.js';

/**
 * Resolve the signed offer's commercial context. System invariant (schema,
 * QuoteOffer.contextMode): the PRIMARY offer's truth is the DEAL; a parallel
 * offer carries its OWN product/date/total and is immune to Deal edits. That
 * rule is applied HERE, once, and the resolved values are frozen into the
 * report payload — the renderer stays layout-only.
 */
export function resolveSignedQuoteContext(offer, deal) {
  const own = offer?.contextMode === 'own';
  const productName = own
    ? (offer?.product?.nameHe || null)
    : (deal?.product?.nameHe || null);
  const locationName = own
    ? (offer?.location?.nameHe || null)
    : (deal?.location?.nameHe || null);
  const totalMinor = offer?.valueMinor != null
    ? Number(offer.valueMinor)
    : (own ? null : (deal?.valueMinor != null ? Number(deal.valueMinor) : null));
  return {
    tourDate: (own ? offer?.tourDate : deal?.tourDate) || null,
    tourTime: (own ? offer?.tourTime : deal?.tourTime) || null,
    productName: [productName, locationName].filter(Boolean).join(' - ') || null,
    totalMinor,
  };
}

export async function reportQuoteSigned(document, { client = prisma, log = console } = {}) {
  if (!document?.dealId) return { skipped: 'no_deal' };
  const [offer, deal] = await Promise.all([
    document.offerId
      ? client.quoteOffer.findUnique({
        where: { id: document.offerId },
        select: {
          offerNo: true, isPrimary: true, contextMode: true, valueMinor: true,
          tourDate: true, tourTime: true,
          product: { select: { nameHe: true } },
          location: { select: { nameHe: true } },
        },
      })
      : null,
    client.deal.findUnique({
      where: { id: document.dealId },
      select: {
        valueMinor: true, tourDate: true, tourTime: true,
        product: { select: { nameHe: true } },
        location: { select: { nameHe: true } },
      },
    }),
  ]);

  return fireAdminReport({
    number: 9,
    // One signature per document, ever — this key IS the signing event.
    idempotencyKey: `quote_signed:${document.id}`,
    dealId: document.dealId,
    data: {
      signedQuote: {
        ...resolveSignedQuoteContext(offer, deal),
        quoteDocumentId: document.id,
        versionNo: document.versionNo,
        offerNo: offer?.offerNo ?? 1,
        isPrimary: offer?.isPrimary ?? true,
      },
    },
  }, log);
}
