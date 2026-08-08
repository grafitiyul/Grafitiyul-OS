import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import { listItems, listCategories } from '../media/library.js';
import { currentTranscript } from '../media/transcripts.js';
import { JOB_KINDS, enqueueJob, mediaJobState } from '../media/jobs.js';
import * as openai from '../media/transcription/openai.js';
import * as youtube from '../media/providers/youtube.js';
import * as vimeo from '../media/providers/vimeo.js';
import {
  requireGrant,
  requireServiceToken,
  workspaceScopeWhere,
} from '../media/serviceAuth.js';

// THE canonical Content API — how Challenge and Recruitment consume GOS
// content. Mounted at /api/content, authenticated by service token.
//
// The contract, stated once:
//   * consumers NEVER touch the database and NEVER hold R2 credentials;
//   * every read is workspace-scoped SERVER-SIDE — a consumer cannot widen its
//     own scope by any request parameter;
//   * playback is a short-lived presigned URL minted per request, so revoking a
//     token actually revokes access rather than leaving permanent URLs loose.
//
// A normal user in Challenge should neither know nor care that the storage is
// physically controlled by GOS.

const router = Router();

router.use(requireServiceToken);

function itemDto(item, { transcript = undefined } = {}) {
  return {
    id: item.id,
    internalName: item.internalName,
    contentType: item.contentType,
    description: item.description,
    language: item.language,
    title: { he: item.publicTitleHe, en: item.publicTitleEn },
    archived: item.archived,
    updatedAt: item.updatedAt,
    categories: (item.categories || []).map((c) => ({
      id: c.category.id,
      nameHe: c.category.nameHe,
      nameEn: c.category.nameEn,
    })),
    media: item.media
      ? {
          id: item.media.id,
          mediaType: item.media.mediaType,
          mimeType: item.media.mimeType,
          durationSeconds: item.media.durationSeconds,
          // Storage strategy is exposed but the OBJECT KEY never is — a
          // consumer must not learn a bucket path it could try to reach.
          storageStrategy: item.media.storageStrategy,
          sourceProvider: item.media.sourceProvider,
          sourceUrl: item.media.sourceUrl,
          thumbnailUrl: item.media.sourceThumbnailUrl,
        }
      : null,
    ...(transcript !== undefined ? { transcript } : {}),
  };
}

/** Scoped lookup — the ONE way this router resolves an item. */
async function scopedItem(req, id) {
  return prisma.libraryItem.findFirst({
    where: { id, ...workspaceScopeWhere(req.contentAuth) },
    include: {
      media: true,
      categories: { include: { category: true } },
      workspaces: { include: { workspace: true } },
    },
  });
}

router.get(
  '/whoami',
  handle(async (req, res) => {
    res.json({
      workspace: { key: req.contentAuth.workspace.key, name: req.contentAuth.workspace.name },
      grants: req.contentAuth.grants,
    });
  }),
);

router.get(
  '/categories',
  requireGrant('canRead'),
  handle(async (req, res) => res.json({ categories: await listCategories(prisma) })),
);

router.get(
  '/items',
  requireGrant('canRead'),
  handle(async (req, res) => {
    const items = await listItems(prisma, {
      search: req.query.search || '',
      categoryId: req.query.categoryId || null,
      contentType: req.query.contentType || null,
      // The scope is applied by id from the TOKEN, never from the query — a
      // consumer passing another workspace's id changes nothing.
      workspaceId: req.contentAuth.workspace.isPrimary ? null : req.contentAuth.workspaceId,
      take: Math.min(Number(req.query.limit) || 100, 200),
    });
    res.json({ items: items.map((i) => itemDto(i)) });
  }),
);

router.get(
  '/items/:id',
  requireGrant('canRead'),
  handle(async (req, res) => {
    const item = await scopedItem(req, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    const t = item.mediaId ? await currentTranscript(prisma, item.mediaId) : null;
    res.json(
      itemDto(item, {
        transcript: t
          ? { text: t.text, language: t.language, generatedAt: t.generatedAt, provider: t.provider }
          : null,
      }),
    );
  }),
);

/**
 * Playback authorisation.
 *
 * Minted per request and short-lived. This is the reason consumers never get
 * raw object URLs: access is a decision made here, every time, and it stops the
 * moment the token is revoked or the item leaves the workspace.
 */
router.get(
  '/items/:id/playback',
  requireGrant('canRead'),
  handle(async (req, res) => {
    const item = await scopedItem(req, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    const media = item.media;
    if (!media) return res.status(404).json({ error: 'no_media' });

    if (!media.objectKey) {
      if (media.sourceProvider === 'youtube') {
        return res.json({ mode: 'embed', embedUrl: youtube.embedUrl(media.sourceExternalId) });
      }
      if (media.sourceProvider === 'vimeo') {
        return res.json({ mode: 'embed', embedUrl: vimeo.embedUrl(media.sourceExternalId) });
      }
      return res.status(422).json({ error: 'no_playable_source' });
    }
    if (!r2.isConfigured()) return res.status(503).json({ error: 'storage_not_configured' });
    res.set('Cache-Control', 'no-store');
    res.json({
      mode: 'file',
      url: await r2.presignGet({ key: media.objectKey, expiresIn: 900 }),
      expiresInSeconds: 900,
      mimeType: media.mimeType,
    });
  }),
);

router.get(
  '/items/:id/transcript',
  requireGrant('canRead'),
  handle(async (req, res) => {
    const item = await scopedItem(req, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!item.mediaId) return res.json({ transcript: null, state: 'unavailable' });
    const [t, job] = await Promise.all([
      currentTranscript(prisma, item.mediaId),
      mediaJobState(prisma, { mediaId: item.mediaId, kind: JOB_KINDS.transcribe }),
    ]);
    res.json({
      transcript: t
        ? { text: t.text, language: t.language, generatedAt: t.generatedAt, provider: t.provider, model: t.model }
        : null,
      job,
    });
  }),
);

router.post(
  '/items/:id/transcribe',
  requireGrant('canTranscribe'),
  handle(async (req, res) => {
    const item = await scopedItem(req, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!item.media) return res.status(422).json({ error: 'no_media' });
    if (!openai.isConfigured()) {
      return res.status(503).json({ error: 'transcription_not_configured' });
    }
    const can = openai.transcribability(item.media);
    if (!can.ok) return res.status(422).json({ error: can.reason });
    const { job, created } = await enqueueJob(prisma, {
      mediaId: item.mediaId,
      kind: JOB_KINDS.transcribe,
      payload: { language: item.language || null },
    });
    res.status(created ? 201 : 200).json({ jobId: job.id, status: job.status, created });
  }),
);

router.patch(
  '/items/:id',
  requireGrant('canWrite'),
  handle(async (req, res) => {
    const item = await scopedItem(req, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    // Consumers may describe content, never re-point it at other storage or
    // change who else can see it.
    const data = {};
    for (const k of ['description', 'publicTitleHe', 'publicTitleEn']) {
      if (k in (req.body || {})) data[k] = String(req.body[k] || '').trim() || null;
    }
    if (Object.keys(data).length === 0) return res.status(422).json({ error: 'nothing_to_update' });
    const updated = await prisma.libraryItem.update({ where: { id: item.id }, data });
    res.json({ id: updated.id });
  }),
);

export default router;
