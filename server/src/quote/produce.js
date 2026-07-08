import { composeQuoteDraftPreview, toPublicModel } from './composer.js';
import { newPublicToken, ensureOffer } from './quoteDocument.js';

// Produce ("הפק") — the FREEZE event of the quote module.
//
// Generating a quote clones the deal's working draft into a NEW immutable
// QuoteDocument: its own permanent publicToken (the URL the customer receives —
// it never changes and never re-points), a frozen renderModelSnapshot (exactly
// what the operator previewed), and the next versionNo within the offer. The
// draft itself is untouched and lives on as the working copy for the next
// version. Signing later locks the SAME snapshot — a customer can never sign
// content that differs from what was generated.
//
// Version-number race: (offerId, versionNo) is DB-unique, so two concurrent
// produce calls cannot mint the same number — the loser throws and the operator
// simply retries.
export async function produceQuoteDocument(client, draftId) {
  const draft = await client.quoteDocument.findUnique({ where: { id: draftId } });
  if (!draft) return { error: 'not_found' };
  if (draft.status !== 'draft') return { error: 'not_draft' };

  // Legacy drafts predate offers — adopt into the deal's primary offer.
  let offerId = draft.offerId;
  if (!offerId) {
    const offer = await ensureOffer(client, draft.dealId);
    offerId = offer.id;
    await client.quoteDocument.update({ where: { id: draft.id }, data: { offerId } });
  }

  const composed = await composeQuoteDraftPreview(client, draft.id);
  if (composed.error) return composed;
  const snapshot = toPublicModel(composed.model);

  const agg = await client.quoteDocument.aggregate({
    where: { offerId, versionNo: { not: null } },
    _max: { versionNo: true },
  });
  const versionNo = (agg?._max?.versionNo || 0) + 1;

  const doc = await client.quoteDocument.create({
    data: {
      dealId: draft.dealId,
      quoteVersionId: draft.quoteVersionId,
      offerId,
      versionNo,
      status: 'produced',
      language: draft.language,
      publicToken: newPublicToken(),
      displayProductName: draft.displayProductName,
      compositionDraft: draft.compositionDraft ?? undefined,
      overrideState: draft.overrideState ?? undefined,
      renderModelSnapshot: snapshot,
      producedAt: new Date(),
    },
  });

  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  return { doc, offer };
}
