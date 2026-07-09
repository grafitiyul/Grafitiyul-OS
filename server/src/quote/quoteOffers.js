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
