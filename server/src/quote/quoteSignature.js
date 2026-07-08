import { composeQuoteDraftPreview, toPublicModel, toPublicSignature, isLockedStatus, findNewerVersion } from './composer.js';

// Signing a proposal — the permanent audit record + the lock. One signature per
// QuoteDocument (enforced by the unique quoteDocumentId); a signed document is
// frozen (renderModelSnapshot = exactly what was signed) and can never be signed
// again. A later change requires a NEW QuoteDocument revision, not a re-sign.

const METHODS = ['typed', 'uploaded', 'drawn'];
// Data-URL cap. Drawn canvases are a few KB; uploaded photos are downscaled on the
// client. This is a safety bound, not the primary size control.
const MAX_IMAGE_CHARS = 900 * 1024; // ~900 KB of base64

export async function signQuoteByToken(client, token, input, meta) {
  if (!token || typeof token !== 'string') return { error: 'not_found' };

  const document = await client.quoteDocument.findUnique({
    where: { publicToken: token },
    include: { signature: true },
  });
  // Drafts are never public and never signable — only produced documents are.
  if (!document || document.status === 'draft') return { error: 'not_found' };

  // Already signed / finalised → do not create a second signature.
  if (document.signature || isLockedStatus(document.status)) {
    return { error: 'already_signed' };
  }

  // A version superseded by a newer version of the same offer is not signable —
  // the public page shows the replacement screen; this guard covers direct POSTs.
  const newer = await findNewerVersion(client, document);
  if (newer) return { error: 'superseded' };

  const method = METHODS.includes(input?.method) ? input.method : null;
  if (!method) return { error: 'invalid_method' };

  const signerName = typeof input?.signerName === 'string' ? input.signerName.trim().slice(0, 120) : '';

  // Validation is scoped to the method: typed needs a name; uploaded/drawn need an
  // image (the image IS the signature — no name is collected for those methods).
  let signatureImage = null;
  if (method === 'typed') {
    if (!signerName) return { error: 'name_required' };
  } else {
    const img = typeof input?.signatureImage === 'string' ? input.signatureImage : '';
    if (!/^data:image\/(png|jpeg|jpg);base64,/.test(img)) return { error: 'image_required' };
    if (img.length > MAX_IMAGE_CHARS) return { error: 'image_too_large' };
    signatureImage = img;
  }

  // The customer signs EXACTLY the frozen snapshot they were shown (written at
  // produce time). Live recompose remains only as a legacy safety net for
  // pre-freeze documents.
  let snapshot = document.renderModelSnapshot;
  if (!snapshot) {
    const composed = await composeQuoteDraftPreview(client, document.id);
    if (composed.error) return composed;
    snapshot = toPublicModel(composed.model);
  }

  const timezone = typeof input?.timezone === 'string' ? input.timezone.slice(0, 64) : null;

  const [signature] = await client.$transaction([
    client.quoteSignature.create({
      data: {
        quoteDocumentId: document.id,
        quoteVersionId: document.quoteVersionId,
        method,
        signerName,
        signatureImage,
        ipAddress: meta?.ip ? String(meta.ip).slice(0, 64) : null,
        userAgent: meta?.userAgent ? String(meta.userAgent).slice(0, 400) : null,
        language: document.language,
        timezone,
        createdBy: null, // customer-signed; an admin-on-behalf path would set this
      },
    }),
    client.quoteDocument.update({
      where: { id: document.id },
      // producedAt is the GENERATION moment — never overwritten by signing.
      data: { status: 'accepted', producedAt: document.producedAt ?? new Date(), renderModelSnapshot: snapshot },
    }),
  ]);

  return { result: { signature: toPublicSignature(signature), status: 'accepted' } };
}
