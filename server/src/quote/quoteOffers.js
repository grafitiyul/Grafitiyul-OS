import { ensureDraftQuoteDocument } from './quoteDocument.js';

// Offer operations — parallel commercial paths of one deal.
//
// Invariants (locked):
//   * Offers never supersede each other; only versions WITHIN an offer do.
//   * Exactly one offer per deal is primary (what a WON deal refers to).
//   * Exactly one QuoteVersion per deal isWorking — the Builder's context. The
//     ACTIVE offer is the one owning that working version; generating always
//     produces into the active offer.
//   * Each offer keeps its own draft QuoteDocument (its own overrides), keyed by
//     its own QuoteVersion — switching offers never mixes wording or pricing.

// Create the next parallel offer: clone the active offer's priced lines into a
// fresh QuoteVersion owned by the new offer, make it the working version (the
// operator immediately adjusts product/pricing and generates), and give the new
// offer its own draft document (fresh from source — an alternative starts clean).
export async function createParallelOffer(client, dealId) {
  const deal = await client.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!deal) return { error: 'not_found' };

  const current = await client.quoteVersion.findFirst({
    where: { dealId, isWorking: true },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });

  const agg = await client.quoteOffer.aggregate({ where: { dealId }, _max: { offerNo: true } });
  const hasAny = (agg?._max?.offerNo || 0) > 0;
  const offer = await client.quoteOffer.create({
    data: { dealId, offerNo: (agg?._max?.offerNo || 0) + 1, isPrimary: !hasAny },
  });

  const version = await client.quoteVersion.create({
    data: { dealId, offerId: offer.id, isWorking: false, status: 'draft' },
  });
  if (current?.lines?.length) {
    await client.quoteLine.createMany({
      data: current.lines.map(({ id, quoteVersionId, createdAt, updatedAt, ...line }) => ({
        ...line,
        quoteVersionId: version.id,
      })),
    });
  }

  const r = await activateOffer(client, dealId, offer.id);
  if (r.error) return r;
  return { offer, activeOfferId: offer.id };
}

// Make an offer the ACTIVE one: its QuoteVersion becomes the working version
// (Builder context) and its draft document is ensured. Idempotent.
export async function activateOffer(client, dealId, offerId) {
  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== dealId) return { error: 'not_found' };
  if (offer.archivedAt) return { error: 'archived' };

  let version = await client.quoteVersion.findFirst({
    where: { dealId, offerId },
    orderBy: { createdAt: 'desc' },
  });
  if (!version) {
    version = await client.quoteVersion.create({
      data: { dealId, offerId, isWorking: false, status: 'draft' },
    });
  }
  if (!version.isWorking) {
    await client.quoteVersion.updateMany({ where: { dealId, isWorking: true }, data: { isWorking: false } });
    await client.quoteVersion.update({ where: { id: version.id }, data: { isWorking: true } });
  }
  // Each offer owns its own draft (ensureDraftQuoteDocument keys on the working
  // version, which is now this offer's).
  const draft = await ensureDraftQuoteDocument(client, dealId);
  if (draft.error) return draft;
  return { offer, versionId: version.id, draft: draft.doc };
}

// Restore an archived offer to the workspace. Its offerNo, documents and
// permanent URLs were never touched by archiving, so nothing else changes. If
// the deal has no live primary (e.g. the primary itself was archived), the
// restored offer takes primary so the workspace never lacks one.
export async function unarchiveOffer(client, dealId, offerId) {
  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== dealId) return { error: 'not_found' };
  if (!offer.archivedAt) return { error: 'not_archived' };
  await client.quoteOffer.update({ where: { id: offerId }, data: { archivedAt: null } });
  const livePrimary = await client.quoteOffer.findFirst({
    where: { dealId, isPrimary: true, archivedAt: null },
  });
  if (!livePrimary) {
    await client.quoteOffer.updateMany({ where: { dealId, isPrimary: true }, data: { isPrimary: false } });
    await client.quoteOffer.update({ where: { id: offerId }, data: { isPrimary: true } });
  }
  return { ok: true };
}

// The audit payload stamped on a deal when it is marked WON: the PRIMARY
// offer's newest generated document. Null when nothing was ever generated —
// the deal was won without a proposal, and that is recorded as such.
export async function buildWonQuoteRef(client, dealId) {
  const offer = await client.quoteOffer.findFirst({
    where: { dealId, isPrimary: true, archivedAt: null },
  });
  if (!offer) return null;
  const doc = await client.quoteDocument.findFirst({
    where: { offerId: offer.id, status: { not: 'draft' } },
    orderBy: { versionNo: 'desc' },
  });
  if (!doc) return null;
  return {
    offerId: offer.id,
    offerNo: offer.offerNo,
    versionNo: doc.versionNo,
    quoteDocumentId: doc.id,
    publicToken: doc.publicToken,
    producedAt: doc.producedAt ? new Date(doc.producedAt).toISOString() : null,
  };
}

// Exactly one primary per deal (transactional flip).
export async function setPrimaryOffer(client, dealId, offerId) {
  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== dealId) return { error: 'not_found' };
  await client.$transaction([
    client.quoteOffer.updateMany({ where: { dealId, isPrimary: true }, data: { isPrimary: false } }),
    client.quoteOffer.update({ where: { id: offerId }, data: { isPrimary: true } }),
  ]);
  return { ok: true };
}

// Remove an offer, safely:
//   * a SIGNED document anywhere in the offer → refuse (the offer is a legal
//     commitment trail; nothing about it may disappear).
//   * generated (produced) documents exist → ARCHIVE, never delete: the offer
//     leaves the workspace tabs, but every generated document stays reachable
//     (history dialog, admin archive view, permanent public URLs).
//   * nothing ever generated → hard delete the offer with its draft + pricing
//     rows (a fresh mistake leaves no trace).
// If the removed offer was primary/active, both roles fall back to the first
// remaining non-archived offer so the workspace never dangles.
export async function removeOrArchiveOffer(client, dealId, offerId) {
  const offer = await client.quoteOffer.findUnique({
    where: { id: offerId },
    include: {
      quoteDocuments: {
        where: { status: { not: 'draft' } },
        select: { id: true, signature: { select: { id: true } } },
      },
      quoteVersions: { select: { id: true, isWorking: true } },
    },
  });
  if (!offer || offer.dealId !== dealId) return { error: 'not_found' };
  if (offer.quoteDocuments.some((d) => d.signature)) return { error: 'has_signed' };

  const wasWorking = offer.quoteVersions.some((v) => v.isWorking);
  let mode;
  if (offer.quoteDocuments.length === 0) {
    // Never generated → hard delete: drafts, pricing versions (lines cascade),
    // then the offer row itself.
    await client.quoteDocument.deleteMany({ where: { offerId, status: 'draft' } });
    await client.quoteVersion.deleteMany({ where: { offerId } });
    await client.quoteOffer.delete({ where: { id: offerId } });
    mode = 'deleted';
  } else {
    await client.quoteOffer.update({ where: { id: offerId }, data: { archivedAt: new Date() } });
    mode = 'archived';
  }

  // Fall back primary + Builder context to the first remaining live offer.
  const fallback = await client.quoteOffer.findFirst({
    where: { dealId, archivedAt: null },
    orderBy: { offerNo: 'asc' },
  });
  if (fallback) {
    if (offer.isPrimary) {
      await client.quoteOffer.updateMany({ where: { dealId, isPrimary: true }, data: { isPrimary: false } });
      await client.quoteOffer.update({ where: { id: fallback.id }, data: { isPrimary: true } });
    }
    if (wasWorking) {
      const r = await activateOffer(client, dealId, fallback.id);
      if (r.error) return r;
    }
  }
  return { mode };
}
