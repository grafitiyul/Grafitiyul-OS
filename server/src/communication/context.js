// THE trigger-context loader — one include tree shared by the live delivery
// engine, the worker's pre-send re-resolution, and the preview route, so
// preview can never disagree with actual sending behavior.
//
// Shape: { deal, contact, fieldContact, org, tour, payment, reservation,
// quoteDoc } — every branch nullable; the variable registry and condition
// evaluator read ONLY from this object.

import { prisma } from '../db.js';
import { dealCollection } from '../collection.js';

const DEAL_INCLUDE = {
  organization: { include: { organizationType: true } },
  organizationType: true,
  organizationSubtype: true,
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
          assignments: { include: { personRef: true } },
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
export function contactFullName(contact, lang = 'he') {
  if (!contact) return null;
  const he = `${contact.firstNameHe || ''} ${contact.lastNameHe || ''}`.trim();
  const en = `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim();
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
 * Load the full context for a trigger payload: { dealId?, sessionId?,
 * tourEventId? }. At least one id is required.
 */
export async function loadTriggerContext({ dealId = null, sessionId = null, tourEventId = null } = {}) {
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
        assignments: { include: { personRef: true } },
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

  return {
    deal,
    contact,
    fieldContact: fieldDc?.contact || null,
    org: deal?.organization || reservation?.organization || null,
    tour,
    payment,
    reservation,
    quoteDoc,
  };
}
