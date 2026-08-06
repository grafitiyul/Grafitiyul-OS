import { composeQuoteDraftPreview, toPublicModel, mergeOverrideState } from './composer.js';
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
// opts.temporaryOverrideState: a one-shot override layer for THIS generation
// only — merged into the snapshot (and recorded on the produced document as the
// effective override state), but NEVER written to the draft. Future versions go
// back to the Deal's persistent overrides.
//
// BUSINESS INVARIANT — a quote is always issued TO AN ORGANIZATION. This is the
// ONE place a quote is ever created (first version, alternate offer, revision,
// preview-to-send, any API caller all land here), so the rule is enforced here
// and not in a modal: a Deal with no organizationId cannot generate a quote and
// gets `organization_required` back. The client turns that code into the
// organization-completion dialog and resumes; nothing is written meanwhile —
// the check runs BEFORE the legacy-offer adoption, so a refused generation
// leaves the draft, the offers and the deal exactly as they were.
export async function produceQuoteDocument(client, draftId, opts = {}) {
  const draft = await client.quoteDocument.findUnique({ where: { id: draftId } });
  if (!draft) return { error: 'not_found' };
  if (draft.status !== 'draft') return { error: 'not_draft' };

  const deal = await client.deal.findUnique({
    where: { id: draft.dealId },
    select: { id: true, organizationId: true },
  });
  if (!deal) return { error: 'deal_not_found' };
  if (!deal.organizationId) return { error: 'organization_required' };
  const temporary = opts.temporaryOverrideState && typeof opts.temporaryOverrideState === 'object'
    ? opts.temporaryOverrideState
    : null;

  // Legacy drafts predate offers — adopt into the deal's primary offer.
  let offerId = draft.offerId;
  if (!offerId) {
    const offer = await ensureOffer(client, draft.dealId);
    offerId = offer.id;
    await client.quoteDocument.update({ where: { id: draft.id }, data: { offerId } });
  }

  const composed = await composeQuoteDraftPreview(client, draft.id, { overrideOverlay: temporary });
  if (composed.error) return composed;
  const snapshot = toPublicModel(composed.model);
  // What actually produced this snapshot (audit) — persisted + one-shot merged.
  const effectiveOverrideState = temporary
    ? mergeOverrideState(draft.overrideState, temporary)
    : draft.overrideState;

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
      overrideState: effectiveOverrideState ?? undefined,
      renderModelSnapshot: snapshot,
      producedAt: new Date(),
    },
  });

  const offer = await client.quoteOffer.findUnique({ where: { id: offerId } });
  return { doc, offer };
}
