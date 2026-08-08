import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import {
  CONTENT_TYPES,
  createCategory,
  createItem,
  deleteCategory,
  getItem,
  listCategories,
  listItems,
  setItemArchived,
  transcriptState,
  updateCategory,
  updateItem,
} from '../media/library.js';
import { initiateLibraryUpload } from '../media/uploads.js';
import { completeUpload, getUploadTargets } from '../tours/gallery/uploads.js';
import { JOB_KINDS, enqueueJob, mediaJobState } from '../media/jobs.js';
import {
  archiveCurrentTranscript,
  currentTranscript,
  restoreTranscript,
  transcriptHistory,
} from '../media/transcripts.js';
import * as openai from '../media/transcription/openai.js';
import * as youtube from '../media/providers/youtube.js';
import * as vimeo from '../media/providers/vimeo.js';
import { importExternalVideos } from '../media/imports.js';
import { isGarbageCollectable } from '../media/usage.js';
import { createServiceToken, revokeServiceToken } from '../media/serviceAuth.js';

// ספריית תוכן — operator API. Mounted behind requireAdminAuth.

const router = Router();
const actorId = (req) => req.adminAuth?.userId || null;

/**
 * Playback for one asset.
 *
 * R2 objects get a short-lived presigned URL — the raw object URL is never
 * exposed, so access always goes back through this authorised route. External
 * references get the provider's safe embed instead; GOS never proxies them.
 */
async function playbackFor(media) {
  if (!media) return null;
  if (media.sourceProvider === 'youtube' && !media.objectKey) {
    return { mode: 'embed', embedUrl: youtube.embedUrl(media.sourceExternalId) };
  }
  if (media.sourceProvider === 'vimeo' && !media.objectKey) {
    return { mode: 'embed', embedUrl: vimeo.embedUrl(media.sourceExternalId) };
  }
  if (media.objectKey && r2.isConfigured()) {
    return {
      mode: 'file',
      url: await r2.presignGet({ key: media.objectKey, expiresIn: 3600 }),
      downloadUrl: await r2.presignGet({
        key: media.objectKey,
        expiresIn: 300,
        downloadName: media.originalFileName,
      }),
    };
  }
  return { mode: 'unavailable', reason: media.objectKey ? 'r2_not_configured' : 'no_media' };
}

function mediaDto(media) {
  if (!media) return null;
  return {
    id: media.id,
    mediaType: media.mediaType,
    mimeType: media.mimeType,
    originalFileName: media.originalFileName,
    byteSize: media.byteSize == null ? null : Number(media.byteSize),
    durationSeconds: media.durationSeconds,
    width: media.width,
    height: media.height,
    storageStrategy: media.storageStrategy,
    sourceProvider: media.sourceProvider,
    sourceExternalId: media.sourceExternalId,
    sourceUrl: media.sourceUrl,
    sourceTitle: media.sourceTitle,
    sourceThumbnailUrl: media.sourceThumbnailUrl,
    sourcePublishedAt: media.sourcePublishedAt,
    importedAt: media.importedAt,
    mirroredAt: media.mirroredAt,
  };
}

function itemDto(item) {
  return {
    id: item.id,
    internalName: item.internalName,
    contentType: item.contentType,
    description: item.description,
    language: item.language,
    publicTitleHe: item.publicTitleHe,
    publicTitleEn: item.publicTitleEn,
    publicDescriptionHe: item.publicDescriptionHe,
    publicDescriptionEn: item.publicDescriptionEn,
    archived: item.archived,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    categories: (item.categories || []).map((c) => ({
      id: c.category.id,
      nameHe: c.category.nameHe,
      nameEn: c.category.nameEn,
    })),
    workspaces: (item.workspaces || []).map((w) => ({
      id: w.workspace.id,
      key: w.workspace.key,
      name: w.workspace.name,
      access: w.access,
    })),
    media: mediaDto(item.media),
    transcriptState: item.transcriptState || null,
  };
}

// ---------- meta ----------

router.get(
  '/meta',
  handle(async (req, res) => {
    const [categories, workspaces, vimeoCaps] = await Promise.all([
      listCategories(prisma),
      prisma.contentWorkspace.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      // The live capability probe — never a guess. Cheap enough per settings
      // load, and wrong information here would promise an import that fails.
      vimeo.isConfigured() ? vimeo.capabilities().catch((e) => ({
        configured: true,
        canListVideos: false,
        canMirrorToR2: false,
        reason: e?.providerReason || e?.message || 'probe_failed',
      })) : vimeo.capabilities(),
    ]);
    res.json({
      contentTypes: CONTENT_TYPES,
      categories,
      workspaces,
      providers: {
        youtube: youtube.configHint(),
        vimeo: { ...vimeo.configHint(), capabilities: vimeoCaps },
        transcription: openai.configHint(),
      },
    });
  }),
);

// ---------- categories ----------

router.get(
  '/categories',
  handle(async (req, res) => {
    res.json({
      categories: await listCategories(prisma, {
        includeArchived: String(req.query.includeArchived || '') === 'true',
      }),
    });
  }),
);

router.post(
  '/categories',
  handle(async (req, res) => res.status(201).json(await createCategory(prisma, req.body || {}))),
);

router.patch(
  '/categories/:id',
  handle(async (req, res) => res.json(await updateCategory(prisma, req.params.id, req.body || {}))),
);

router.delete(
  '/categories/:id',
  handle(async (req, res) => res.json(await deleteCategory(prisma, req.params.id))),
);

// ---------- items ----------

router.get(
  '/items',
  handle(async (req, res) => {
    const items = await listItems(prisma, {
      search: req.query.search || '',
      categoryId: req.query.categoryId || null,
      contentType: req.query.contentType || null,
      sourceProvider: req.query.source || null,
      workspaceId: req.query.workspaceId || null,
      includeArchived: String(req.query.includeArchived || '') === 'true',
    });
    res.json({ items: items.map(itemDto) });
  }),
);

router.post(
  '/items',
  handle(async (req, res) => {
    const item = await createItem(prisma, req.body || {}, { actorId: actorId(req) });
    res.status(201).json(itemDto(item));
  }),
);

router.get(
  '/items/:id',
  handle(async (req, res) => {
    const item = await getItem(prisma, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    const [playback, jobState] = await Promise.all([
      playbackFor(item.media),
      item.mediaId
        ? mediaJobState(prisma, { mediaId: item.mediaId, kind: JOB_KINDS.transcribe })
        : null,
    ]);
    const can = item.media ? openai.transcribability(item.media) : { ok: false, reason: 'no_media' };
    res.json({
      ...itemDto(item),
      playback,
      transcript: item.transcript
        ? {
            id: item.transcript.id,
            text: item.transcript.text,
            language: item.transcript.language,
            provider: item.transcript.provider,
            model: item.transcript.model,
            generatedAt: item.transcript.generatedAt,
            hasSegments: !!item.transcript.segments,
          }
        : null,
      transcriptHistory: item.transcriptHistory,
      transcriptState: transcriptState(item, item.transcript, jobState?.status ? { status: jobState.status, lastError: jobState.error } : null),
      transcription: {
        // Everything the UI needs to decide whether to OFFER the button, and
        // what to say when it cannot.
        providerConfigured: openai.isConfigured(),
        canTranscribe: can.ok && openai.isConfigured(),
        blockedReason: !openai.isConfigured() ? 'transcription_not_configured' : can.ok ? null : can.reason,
        job: jobState,
      },
    });
  }),
);

router.patch(
  '/items/:id',
  handle(async (req, res) => {
    const item = await updateItem(prisma, req.params.id, req.body || {}, { actorId: actorId(req) });
    res.json(itemDto(item));
  }),
);

router.post(
  '/items/:id/archive',
  handle(async (req, res) => {
    const item = await setItemArchived(prisma, req.params.id, req.body?.archived !== false, {
      actorId: actorId(req),
    });
    res.json({ id: item.id, archived: item.archived });
  }),
);

/**
 * Delete an item. The DESCRIPTION goes; the asset only goes if nothing else
 * points at it and the caller explicitly asked — reference-aware, like the
 * gallery path.
 */
router.delete(
  '/items/:id',
  handle(async (req, res) => {
    const item = await prisma.libraryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'not_found' });
    const wantsAsset = String(req.query.deleteAsset || '') === 'true';
    let assetDeleted = false;
    let stillReferencedBy = [];

    if (item.mediaId) {
      const gc = await isGarbageCollectable(prisma, item.mediaId, {
        refType: 'library',
        refId: item.id,
      });
      stillReferencedBy = gc.ok ? [] : gc.refs;
      await prisma.libraryItem.delete({ where: { id: item.id } });
      if (wantsAsset && gc.ok) {
        const media = await prisma.tourMedia.findUnique({ where: { id: item.mediaId } });
        if (media?.objectKey && r2.isConfigured()) await r2.deleteObject(media.objectKey);
        await prisma.tourMedia.delete({ where: { id: item.mediaId } }).catch(() => {});
        assetDeleted = true;
      }
    } else {
      await prisma.libraryItem.delete({ where: { id: item.id } });
    }
    res.json({ ok: true, assetDeleted, stillReferencedBy });
  }),
);

// ---------- R2 upload (same verified pipeline as galleries) ----------

router.post(
  '/uploads',
  handle(async (req, res) => {
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured' });
    const result = await initiateLibraryUpload(prisma, {
      uploader: { type: 'office', userId: actorId(req) },
      file: req.body?.file || {},
    });
    if (result.error) return res.status(422).json({ error: result.error });
    res.status(201).json(result);
  }),
);

async function libraryMediaRow(req, res) {
  const media = await prisma.tourMedia.findFirst({
    where: { id: req.params.mediaId, galleryId: null, tourEventId: null, deletedAt: null },
  });
  if (!media) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return media;
}

router.post(
  '/uploads/:mediaId/urls',
  handle(async (req, res) => {
    const media = await libraryMediaRow(req, res);
    if (!media) return;
    const out = await getUploadTargets(prisma, media, req.body || {});
    if (out.error) return res.status(out.status || 409).json({ error: out.error });
    res.json(out);
  }),
);

router.post(
  '/uploads/:mediaId/complete',
  handle(async (req, res) => {
    const media = await libraryMediaRow(req, res);
    if (!media) return;
    const result = await completeUpload(prisma, media, req.body || {}, {
      origin: { actorType: 'admin', createdBy: actorId(req) },
    });
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.json(result);
  }),
);

// ---------- external sources ----------

router.get(
  '/sources/youtube/videos',
  handle(async (req, res) => {
    if (!youtube.isConfigured()) {
      return res.status(503).json({ error: 'youtube_not_configured', ...youtube.configHint() });
    }
    const channel = await youtube.resolveChannel({
      channelId: req.query.channelId || process.env.YOUTUBE_CHANNEL_ID || null,
      handle: req.query.handle || null,
    });
    if (!channel.uploadsPlaylistId) {
      return res.status(422).json({ error: 'youtube_channel_has_no_uploads' });
    }
    const page = await youtube.listChannelVideos({
      uploadsPlaylistId: channel.uploadsPlaylistId,
      pageToken: req.query.pageToken || null,
    });
    const already = await prisma.tourMedia.findMany({
      where: {
        sourceProvider: 'youtube',
        sourceExternalId: { in: page.videos.map((v) => v.externalId) },
      },
      select: { sourceExternalId: true, libraryItems: { select: { id: true } } },
    });
    const map = new Map(already.map((a) => [a.sourceExternalId, a.libraryItems?.[0]?.id || null]));
    res.json({
      channel,
      nextPageToken: page.nextPageToken,
      videos: page.videos.map((v) => ({
        ...v,
        alreadyImported: map.has(v.externalId),
        existingItemId: map.get(v.externalId) || null,
      })),
    });
  }),
);

router.get(
  '/sources/vimeo/videos',
  handle(async (req, res) => {
    if (!vimeo.isConfigured()) {
      return res.status(503).json({ error: 'vimeo_not_configured', ...vimeo.configHint() });
    }
    const page = await vimeo.listVideos({ page: Number(req.query.page) || 1 });
    const already = await prisma.tourMedia.findMany({
      where: {
        sourceProvider: 'vimeo',
        sourceExternalId: { in: page.videos.map((v) => v.externalId) },
      },
      select: { sourceExternalId: true, libraryItems: { select: { id: true } } },
    });
    const map = new Map(already.map((a) => [a.sourceExternalId, a.libraryItems?.[0]?.id || null]));
    res.json({
      page: page.page,
      nextPage: page.nextPage,
      total: page.total,
      videos: page.videos.map((v) => ({
        ...v,
        alreadyImported: map.has(v.externalId),
        existingItemId: map.get(v.externalId) || null,
      })),
    });
  }),
);

router.get(
  '/sources/vimeo/capabilities',
  handle(async (req, res) => res.json(await vimeo.capabilities())),
);

router.post(
  '/import',
  handle(async (req, res) => {
    const { provider, videos, categoryIds, workspaceIds, strategy, language } = req.body || {};
    if (!['youtube', 'vimeo'].includes(provider)) {
      return res.status(422).json({ error: 'invalid_provider' });
    }
    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(422).json({ error: 'no_videos_selected' });
    }
    const result = await importExternalVideos(prisma, {
      provider,
      videos,
      categoryIds: categoryIds || [],
      workspaceIds: workspaceIds || null,
      strategy: strategy === 'mirror' ? 'mirror' : 'reference',
      language: language || null,
      actorId: actorId(req),
    });
    res.status(201).json(result);
  }),
);

// ---------- service tokens (external consumers) ----------

router.get(
  '/service-tokens',
  handle(async (req, res) => {
    const tokens = await prisma.contentServiceToken.findMany({
      include: { workspace: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      tokens: tokens.map((t) => ({
        id: t.id,
        label: t.label,
        workspace: { key: t.workspace.key, name: t.workspace.name },
        grants: { canRead: t.canRead, canWrite: t.canWrite, canUpload: t.canUpload, canTranscribe: t.canTranscribe },
        status: t.status,
        lastUsedAt: t.lastUsedAt,
        createdAt: t.createdAt,
        // The token itself is unrecoverable by design — only its hash is
        // stored, so there is nothing to show here even to an admin.
      })),
    });
  }),
);

router.post(
  '/service-tokens',
  handle(async (req, res) => {
    const { workspaceId, label, canRead, canWrite, canUpload, canTranscribe } = req.body || {};
    if (!workspaceId) return res.status(422).json({ error: 'workspace_required' });
    const created = await createServiceToken(prisma, {
      workspaceId,
      label,
      canRead: canRead !== false,
      canWrite: !!canWrite,
      canUpload: !!canUpload,
      canTranscribe: !!canTranscribe,
      createdById: actorId(req),
    });
    // Shown ONCE. There is no endpoint that can return it again.
    res.status(201).json(created);
  }),
);

router.post(
  '/service-tokens/:id/revoke',
  handle(async (req, res) => {
    const r = await revokeServiceToken(prisma, req.params.id);
    res.json({ revoked: r.count });
  }),
);

// ---------- transcription ----------

router.post(
  '/items/:id/transcribe',
  handle(async (req, res) => {
    const item = await prisma.libraryItem.findUnique({
      where: { id: req.params.id },
      include: { media: true },
    });
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!item.media) return res.status(422).json({ error: 'no_media' });
    if (!openai.isConfigured()) {
      return res.status(503).json({ error: 'transcription_not_configured', ...openai.configHint() });
    }
    const can = openai.transcribability(item.media);
    if (!can.ok) return res.status(422).json({ error: can.reason, detail: can });

    // Idempotent: a double click reuses the live job instead of queueing a
    // second one (enqueueJob enforces it).
    const { job, created } = await enqueueJob(prisma, {
      mediaId: item.mediaId,
      kind: JOB_KINDS.transcribe,
      payload: { language: item.language || null },
      requestedById: actorId(req),
    });
    res.status(created ? 201 : 200).json({ jobId: job.id, status: job.status, created });
  }),
);

router.get(
  '/items/:id/transcript',
  handle(async (req, res) => {
    const item = await prisma.libraryItem.findUnique({ where: { id: req.params.id } });
    if (!item?.mediaId) return res.status(404).json({ error: 'not_found' });
    const [current, history, job] = await Promise.all([
      currentTranscript(prisma, item.mediaId),
      transcriptHistory(prisma, item.mediaId),
      mediaJobState(prisma, { mediaId: item.mediaId, kind: JOB_KINDS.transcribe }),
    ]);
    res.json({ current, history, job });
  }),
);

router.post(
  '/items/:id/transcript/restore',
  handle(async (req, res) => {
    const item = await prisma.libraryItem.findUnique({ where: { id: req.params.id } });
    if (!item?.mediaId) return res.status(404).json({ error: 'not_found' });
    const restored = await restoreTranscript(prisma, {
      mediaId: item.mediaId,
      transcriptId: req.body?.transcriptId,
    });
    res.json({ id: restored.id, generatedAt: restored.generatedAt });
  }),
);

router.delete(
  '/items/:id/transcript',
  handle(async (req, res) => {
    const item = await prisma.libraryItem.findUnique({ where: { id: req.params.id } });
    if (!item?.mediaId) return res.status(404).json({ error: 'not_found' });
    // Archives rather than destroys — the text stays as history.
    const count = await archiveCurrentTranscript(prisma, item.mediaId);
    res.json({ archived: count });
  }),
);

export default router;
