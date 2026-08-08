// Reference tracking — the input to reference-aware deletion.
//
// The rule this exists to enforce: a physical asset is NEVER destroyed because
// one consumer stopped using it. "Remove from gallery" must not be able to
// break a quote, an email, a site page or another workspace's library entry
// that points at the same bytes.
//
// Any module that starts using an asset registers here (the same proven pattern
// as the Challenge system's SoundAssetUsage), so answering "is this still in
// use?" is a query rather than a codebase-wide grep that silently goes stale.

export const REF_TYPES = Object.freeze({
  gallery: 'gallery',
  library: 'library',
  quote: 'quote',
  email: 'email',
  whatsapp: 'whatsapp',
  sitePage: 'site_page',
  deal: 'deal',
});

/** Idempotent: registering the same usage twice is a no-op, not a duplicate. */
export async function registerUsage(client, { mediaId, refType, refId }) {
  if (!mediaId || !refType || !refId) return null;
  return client.mediaUsage.upsert({
    where: { mediaId_refType_refId: { mediaId, refType, refId } },
    update: {},
    create: { mediaId, refType, refId },
  });
}

export async function releaseUsage(client, { mediaId, refType, refId }) {
  if (!mediaId || !refType || !refId) return 0;
  const res = await client.mediaUsage.deleteMany({ where: { mediaId, refType, refId } });
  return res.count;
}

/** Release every usage a consumer holds — e.g. when a library item is deleted. */
export async function releaseAllForRef(client, { refType, refId }) {
  const res = await client.mediaUsage.deleteMany({ where: { refType, refId } });
  return res.count;
}

/**
 * Everything currently pointing at this asset.
 *
 * Registered MediaUsage rows are combined with the references the schema itself
 * guarantees (owning gallery, curated gallery memberships, library items).
 * Deriving the structural ones rather than trusting registration means a
 * consumer that forgot to register still cannot have its asset deleted out from
 * under it — the safe direction to be wrong in.
 */
export async function mediaReferences(client, mediaId) {
  const [media, curated, libraryItems, usages] = await Promise.all([
    client.tourMedia.findUnique({
      where: { id: mediaId },
      select: { id: true, galleryId: true, deletedAt: true, objectKey: true, thumbKey: true, posterKey: true, storageStrategy: true },
    }),
    client.galleryItem.findMany({ where: { mediaId }, select: { galleryId: true } }),
    client.libraryItem.findMany({ where: { mediaId }, select: { id: true, archived: true } }),
    client.mediaUsage.findMany({ where: { mediaId }, select: { refType: true, refId: true } }),
  ]);
  if (!media) return null;

  const refs = [];
  if (media.galleryId) refs.push({ refType: REF_TYPES.gallery, refId: media.galleryId, role: 'owner' });
  for (const c of curated) refs.push({ refType: REF_TYPES.gallery, refId: c.galleryId, role: 'curated' });
  for (const li of libraryItems) refs.push({ refType: REF_TYPES.library, refId: li.id, role: 'library' });
  for (const u of usages) {
    const already = refs.some((r) => r.refType === u.refType && r.refId === u.refId);
    if (!already) refs.push({ refType: u.refType, refId: u.refId, role: 'registered' });
  }
  return { media, refs };
}

/**
 * May the physical R2 object be destroyed?
 *
 * Only when nothing at all points at the asset. `excludeRef` lets a caller ask
 * the question as it WILL be after the removal it is about to perform ("if I
 * drop this gallery membership, does anything else still need the bytes?"),
 * which is the only way to answer honestly without deleting first and checking
 * afterwards.
 */
export async function isGarbageCollectable(client, mediaId, { excludeRef = null } = {}) {
  const found = await mediaReferences(client, mediaId);
  if (!found) return { ok: false, reason: 'media_not_found', refs: [] };
  const remaining = found.refs.filter(
    (r) => !(excludeRef && r.refType === excludeRef.refType && r.refId === excludeRef.refId),
  );
  return {
    ok: remaining.length === 0,
    reason: remaining.length === 0 ? null : 'still_referenced',
    refs: remaining,
  };
}

/**
 * Remove an asset from ONE gallery.
 *
 * Curated membership → delete the GalleryItem row; the asset is untouched.
 * Owning gallery → SOFT delete, which keeps attribution and audit readable.
 * Either way the R2 object survives this call: physical deletion is a separate,
 * explicit, audited garbage-collection step, never a side effect of tidying.
 */
export async function removeMediaFromGallery(client, { galleryId, mediaId, actorId = null }) {
  const media = await client.tourMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, galleryId: true },
  });
  if (!media) {
    const err = new Error('not_found');
    err.status = 404;
    throw err;
  }
  if (media.galleryId !== galleryId) {
    const res = await client.galleryItem.deleteMany({ where: { galleryId, mediaId } });
    if (res.count === 0) {
      const err = new Error('not_found');
      err.status = 404;
      throw err;
    }
    return { removed: 'membership', assetDeleted: false };
  }
  await client.tourMedia.update({
    where: { id: mediaId },
    data: { deletedAt: new Date(), deletedById: actorId || null },
  });
  return { removed: 'owned', assetDeleted: false };
}
