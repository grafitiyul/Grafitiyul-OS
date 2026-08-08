import { JOB_KINDS, enqueueJob } from './jobs.js';
import { createItem } from './library.js';

// Importing external videos (YouTube / Vimeo) into the Content Library.
//
// Two rules this module exists to enforce:
//
//  1. NOTHING IS EVER AUTO-IMPORTED. Every call carries an explicit list of
//     videos the operator selected. There is no "sync the whole channel".
//  2. Duplicate identity is (provider, externalId) — enforced by a DATABASE
//     unique constraint, never by comparing titles. Two videos can share a
//     title; re-importing one must resolve to the item that already exists.

/** Existing library items for these provider ids, keyed by externalId. */
export async function findAlreadyImported(client, { provider, externalIds }) {
  if (!provider || !externalIds?.length) return new Map();
  const media = await client.tourMedia.findMany({
    where: { sourceProvider: provider, sourceExternalId: { in: externalIds } },
    select: { id: true, sourceExternalId: true, libraryItems: { select: { id: true, internalName: true } } },
  });
  return new Map(
    media.map((m) => [
      m.sourceExternalId,
      { mediaId: m.id, item: m.libraryItems?.[0] || null },
    ]),
  );
}

/**
 * Import a selected set of external videos.
 *
 * `videos` are provider DTOs from the connectors. Each may carry an
 * `internalName` chosen by the operator; when absent the source title seeds it
 * — the operator-facing name is then editable independently forever, because
 * the provider's title is kept separately on the media as `sourceTitle`.
 *
 * `strategy` is per import: 'reference' keeps the video with the provider,
 * 'mirror' additionally queues a copy into R2. Mirroring is only ever attempted
 * when the connector reported the video as genuinely downloadable.
 */
export async function importExternalVideos(
  client,
  { provider, videos = [], categoryIds = [], workspaceIds = null, strategy = 'reference', language = null, actorId = null },
) {
  const results = { imported: [], skipped: [], failed: [] };
  if (!provider || videos.length === 0) return results;

  const existing = await findAlreadyImported(client, {
    provider,
    externalIds: videos.map((v) => v.externalId).filter(Boolean),
  });

  for (const v of videos) {
    if (!v?.externalId) {
      results.failed.push({ externalId: null, error: 'missing_external_id' });
      continue;
    }
    const already = existing.get(v.externalId);
    if (already) {
      // Not an error, and not a silent no-op: the operator gets a pointer to
      // the item that already represents this video so they can open it.
      results.skipped.push({
        externalId: v.externalId,
        reason: 'already_imported',
        mediaId: already.mediaId,
        itemId: already.item?.id || null,
        internalName: already.item?.internalName || null,
      });
      continue;
    }

    const wantsMirror = strategy === 'mirror' && provider === 'vimeo' && v.canMirrorToR2 === true;
    try {
      const media = await client.tourMedia.create({
        data: {
          galleryId: null,
          tourEventId: null,
          objectKey: null,
          mediaType: 'video',
          mimeType: 'video/mp4',
          originalFileName: v.title || v.externalId,
          durationSeconds: v.durationSeconds ?? null,
          // Mirroring is asynchronous: the asset is an external reference until
          // the job actually lands bytes in R2. Claiming 'mirrored_to_r2' here
          // would be reporting success for work that has not started.
          storageStrategy: 'external_reference',
          sourceProvider: provider,
          sourceExternalId: v.externalId,
          sourceUrl: v.url || null,
          sourceTitle: v.title || null,
          sourceThumbnailUrl: v.thumbnailUrl || null,
          sourcePublishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
          sourceUpdatedAt: v.updatedAt ? new Date(v.updatedAt) : null,
          sourceMeta: v.description ? { description: String(v.description).slice(0, 5000) } : undefined,
          importedAt: new Date(),
          uploadStatus: 'ready',
          completedAt: new Date(),
          uploadedByType: 'office',
          uploadedById: actorId,
        },
      });

      const item = await createItem(
        client,
        {
          internalName: String(v.internalName || v.title || v.externalId).trim().slice(0, 300),
          contentType: provider, // 'youtube' | 'vimeo'
          mediaId: media.id,
          language,
          categoryIds,
          workspaceIds,
        },
        { actorId },
      );

      let mirrorJobId = null;
      if (wantsMirror) {
        const { job } = await enqueueJob(client, {
          mediaId: media.id,
          kind: JOB_KINDS.mirrorToR2,
          requestedById: actorId,
        });
        mirrorJobId = job.id;
      }

      results.imported.push({
        externalId: v.externalId,
        itemId: item.id,
        mediaId: media.id,
        internalName: item.internalName,
        mirrorQueued: !!mirrorJobId,
        // Told plainly when the operator asked to mirror and it was not
        // possible, instead of quietly importing a reference.
        mirrorSkippedReason:
          strategy === 'mirror' && !wantsMirror
            ? v.mirrorBlockedReason || 'mirror_not_available_for_this_video'
            : null,
      });
    } catch (e) {
      // The unique constraint is the last line of defence against a double
      // submit racing the pre-check above.
      const dup = e?.code === 'P2002';
      results.failed.push({
        externalId: v.externalId,
        error: dup ? 'already_imported' : String(e?.message || e).slice(0, 200),
      });
    }
  }
  return results;
}
