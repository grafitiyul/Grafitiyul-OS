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

// The Deal fields that form an offer's commercial context (Deal ≡ primary).
const CONTEXT_SELECT = {
  id: true,
  productId: true,
  productVariantId: true,
  locationId: true,
  participants: true,
  tourDate: true,
  tourTime: true,
  valueMinor: true,
};

const contextOf = (src) => ({
  productId: src.productId ?? null,
  productVariantId: src.productVariantId ?? null,
  locationId: src.locationId ?? null,
  participants: src.participants ?? null,
  tourDate: src.tourDate ?? null,
  tourTime: src.tourTime ?? null,
  valueMinor: src.valueMinor ?? null,
});

const EMPTY_CONTEXT = {
  productId: null, productVariantId: null, locationId: null,
  participants: null, tourDate: null, tourTime: null, valueMinor: null,
};

// Create the next parallel offer: clone the active offer's priced lines into a
// fresh QuoteVersion owned by the new offer, make it the working version (the
// operator immediately adjusts product/pricing and generates), and give the new
// offer its own draft document (fresh from source — an alternative starts clean).
// A PARALLEL offer is born contextMode='own', seeded from the Deal's current
// context — the Deal itself is never mutated by creating an alternative.
export async function createParallelOffer(client, dealId) {
  const deal = await client.deal.findUnique({ where: { id: dealId }, select: CONTEXT_SELECT });
  if (!deal) return { error: 'not_found' };

  const current = await client.quoteVersion.findFirst({
    where: { dealId, isWorking: true },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });

  const agg = await client.quoteOffer.aggregate({ where: { dealId }, _max: { offerNo: true } });
  const hasAny = (agg?._max?.offerNo || 0) > 0;
  const offer = await client.quoteOffer.create({
    data: {
      dealId,
      offerNo: (agg?._max?.offerNo || 0) + 1,
      isPrimary: !hasAny,
      // First-ever offer = primary = mirrors the Deal; a parallel one owns its context.
      ...(hasAny ? { contextMode: 'own', ...contextOf(deal) } : {}),
    },
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
    // Full promotion — the Deal adopts the restored offer's commercial context
    // (Deal ≡ primary, always).
    const r = await setPrimaryOffer(client, dealId, offerId);
    if (r.error) return r;
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

// Exactly one primary per deal — and the Deal ALWAYS mirrors the primary.
// Promoting an offer:
//   1. The outgoing primary keeps exactly the context it had (the Deal's
//      current values) — frozen as its own.
//   2. The Deal adopts the new primary's commercial context (product, variant,
//      location, participants, date/time, pricing headline).
//   3. The new primary flips to contextMode='deal' (mirrors the Deal onward).
// WON never does this — it is only the customer's acceptance.
export async function setPrimaryOffer(client, dealId, offerId) {
  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.dealId !== dealId) return { error: 'not_found' };
  if (offer.archivedAt) return { error: 'archived' };
  if (offer.isPrimary) return { ok: true, changed: false };

  const deal = await client.deal.findUnique({ where: { id: dealId }, select: CONTEXT_SELECT });
  if (!deal) return { error: 'not_found' };

  const outgoing = await client.quoteOffer.findFirst({ where: { dealId, isPrimary: true } });

  // 1. Freeze the outgoing primary with the Deal's current context.
  if (outgoing && outgoing.id !== offerId) {
    await client.quoteOffer.update({
      where: { id: outgoing.id },
      data: { isPrimary: false, contextMode: 'own', ...contextOf(deal) },
    });
  } else {
    await client.quoteOffer.updateMany({ where: { dealId, isPrimary: true }, data: { isPrimary: false } });
  }

  // 2. The Deal adopts the new primary's context ('own' offers only — a
  //    deal-mode offer already mirrors the Deal).
  if (offer.contextMode === 'own') {
    const adopt = contextOf(offer);
    if (adopt.valueMinor == null) delete adopt.valueMinor; // never blank the headline
    await client.deal.update({ where: { id: dealId }, data: adopt });
  }

  // 3. The new primary follows the Deal from here on.
  await client.quoteOffer.update({
    where: { id: offerId },
    data: { isPrimary: true, contextMode: 'deal', ...EMPTY_CONTEXT },
  });
  return { ok: true, changed: true };
}

// PURE: route the Price Builder's headline patch (price/product/city/
// participants) by the ACTIVE offer's context mode. Primary (deal-mode) →
// patch the Deal, exactly the historic behavior (Deal ≡ primary). Non-primary
// own-mode offer → patch the OFFER's context; the Deal is never touched by
// pricing work on an alternative.
export function splitBuilderPatch(offer, b = {}) {
  const patch = {};
  if (b.valueMinor !== undefined) patch.valueMinor = BigInt(Math.round(Number(b.valueMinor) || 0));
  if (b.productId !== undefined) patch.productId = b.productId || null;
  if (b.productVariantId !== undefined) patch.productVariantId = b.productVariantId || null;
  if (b.locationId !== undefined) patch.locationId = b.locationId || null;
  if (b.participants !== undefined) {
    const n = parseInt(b.participants, 10);
    patch.participants = Number.isFinite(n) && n >= 0 ? n : null;
  }
  const toOffer = !!offer && !offer.isPrimary && offer.contextMode === 'own';
  return toOffer ? { dealPatch: {}, offerPatch: patch } : { dealPatch: patch, offerPatch: {} };
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
  // Promotion runs the full Deal-mirrors-primary flow (the Deal adopts the
  // fallback offer's commercial context).
  const fallback = await client.quoteOffer.findFirst({
    where: { dealId, archivedAt: null },
    orderBy: { offerNo: 'asc' },
  });
  if (fallback) {
    if (offer.isPrimary) {
      const r = await setPrimaryOffer(client, dealId, fallback.id);
      if (r.error) return r;
    }
    if (wasWorking) {
      const r = await activateOffer(client, dealId, fallback.id);
      if (r.error) return r;
    }
  }
  return { mode };
}
