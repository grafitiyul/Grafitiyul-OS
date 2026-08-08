import { prisma } from '../db.js';
import {
  assertCategoriesMatchWorlds,
  pruneCategoriesOutsideWorlds,
  resolveWorldIds,
  setItemWorlds,
} from './worlds.js';

// ספריית תוכן — the Content Library domain service.
//
// A LibraryItem is HOW an asset is described, categorised and surfaced. The
// asset itself is a TourMedia row (the canonical media object). That separation
// is the point: the same physical video can be a library entry, a gallery item
// and a quote attachment at once, without the bytes ever being copied.
//
// V1 uses flat CATEGORIES, not folders (owner decision, 2026-08-08). Nothing
// about the asset model would have to change to add a hierarchy later.

export const CONTENT_TYPES = Object.freeze([
  'video',
  'audio',
  'image',
  'pdf',
  'document',
  'youtube',
  'vimeo',
  'link',
]);

// Which content types can ever carry a transcript. An image or a bare link has
// no audio track, so offering "תמלל" on one would be an empty promise.
export const TRANSCRIBABLE_TYPES = Object.freeze(['video', 'audio']);

export const PRIMARY_WORKSPACE_KEY = 'gos';

function must(cond, code, status = 422) {
  if (!cond) {
    const err = new Error(code);
    err.status = status;
    throw err;
  }
}

export async function primaryWorkspace(client) {
  return client.contentWorkspace.findUnique({ where: { key: PRIMARY_WORKSPACE_KEY } });
}

// ── Categories ──────────────────────────────────────────────────────────────

// Categories are ALWAYS world-scoped. `worldId` narrows to one world; without
// it every world's categories come back, each carrying its world so the client
// can group them and never present one undifferentiated list.
export async function listCategories(client, { includeArchived = false, worldId = null } = {}) {
  return client.libraryCategory.findMany({
    where: {
      ...(includeArchived ? {} : { archived: false }),
      ...(worldId ? { worldId } : {}),
    },
    include: { world: { select: { id: true, key: true, nameHe: true, nameEn: true } } },
    orderBy: [{ world: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { nameHe: 'asc' }],
  });
}

export async function createCategory(client, { nameHe, nameEn, sortOrder, worldId }) {
  const name = String(nameHe || '').trim();
  must(name, 'name_required');
  // A category with no world could not be offered in a world-first picker.
  must(worldId, 'content_world_required');
  const world = await client.contentWorld.findUnique({ where: { id: worldId } });
  must(world, 'unknown_content_world');
  return client.libraryCategory.create({
    data: {
      worldId,
      nameHe: name,
      nameEn: String(nameEn || '').trim() || null,
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    },
  });
}

export async function updateCategory(client, id, patch) {
  const data = {};
  if ('nameHe' in patch) {
    const v = String(patch.nameHe || '').trim();
    must(v, 'name_required');
    data.nameHe = v;
  }
  if ('nameEn' in patch) data.nameEn = String(patch.nameEn || '').trim() || null;
  if ('sortOrder' in patch) data.sortOrder = Number(patch.sortOrder) || 0;
  if ('archived' in patch) data.archived = !!patch.archived;
  return client.libraryCategory.update({ where: { id }, data });
}

/**
 * Categories ARCHIVE rather than delete while anything still uses them.
 *
 * Hard-deleting a category in use would silently rewrite the history of every
 * item filed under it. An unused category has no history to lose, so it may go
 * for real — which keeps a mistyped category from being permanent clutter.
 */
export async function deleteCategory(client, id) {
  const inUse = await client.libraryItemCategory.count({ where: { categoryId: id } });
  if (inUse > 0) {
    await client.libraryCategory.update({ where: { id }, data: { archived: true } });
    return { archived: true, itemCount: inUse };
  }
  await client.libraryCategory.delete({ where: { id } });
  return { deleted: true };
}

// ── Items ───────────────────────────────────────────────────────────────────

const ITEM_INCLUDE = {
  media: true,
  worlds: { include: { world: true } },
  categories: { include: { category: { include: { world: true } } } },
  workspaces: { include: { workspace: true } },
};

async function setCategories(client, itemId, categoryIds) {
  if (!Array.isArray(categoryIds)) return;
  await client.libraryItemCategory.deleteMany({ where: { itemId } });
  const ids = [...new Set(categoryIds.filter(Boolean))];
  if (ids.length === 0) return;
  await client.libraryItemCategory.createMany({
    data: ids.map((categoryId) => ({ itemId, categoryId })),
    skipDuplicates: true,
  });
}

async function setWorkspaces(client, itemId, workspaceIds, fallbackWorkspaceId) {
  const ids = Array.isArray(workspaceIds) ? [...new Set(workspaceIds.filter(Boolean))] : null;
  // An item with NO workspace would be invisible to everyone, including the
  // person who just created it. Absent input means "the primary workspace",
  // never "no access".
  const final = ids && ids.length ? ids : [fallbackWorkspaceId].filter(Boolean);
  await client.libraryItemWorkspace.deleteMany({ where: { itemId } });
  if (final.length === 0) return;
  await client.libraryItemWorkspace.createMany({
    data: final.map((workspaceId) => ({ itemId, workspaceId })),
    skipDuplicates: true,
  });
}

export async function createItem(client, data, { actorId = null } = {}) {
  const internalName = String(data?.internalName || '').trim();
  must(internalName, 'internal_name_required');
  const contentType = String(data?.contentType || '').trim();
  must(CONTENT_TYPES.includes(contentType), 'invalid_content_type');

  // WORLD FIRST. Both checks run BEFORE the row is created, so an invalid
  // combination never produces a half-filed item that has to be cleaned up.
  const worldIds = await resolveWorldIds(client, data.worldIds);
  await assertCategoriesMatchWorlds(client, { categoryIds: data.categoryIds, worldIds });

  const ws = await primaryWorkspace(client);
  const item = await client.libraryItem.create({
    data: {
      internalName,
      contentType,
      mediaId: data.mediaId || null,
      description: String(data.description || '').trim() || null,
      language: data.language || null,
      publicTitleHe: String(data.publicTitleHe || '').trim() || null,
      publicTitleEn: String(data.publicTitleEn || '').trim() || null,
      publicDescriptionHe: String(data.publicDescriptionHe || '').trim() || null,
      publicDescriptionEn: String(data.publicDescriptionEn || '').trim() || null,
      createdById: actorId,
      updatedById: actorId,
    },
  });
  await setItemWorlds(client, item.id, worldIds);
  await setCategories(client, item.id, data.categoryIds);
  await setWorkspaces(client, item.id, data.workspaceIds, ws?.id);
  return client.libraryItem.findUnique({ where: { id: item.id }, include: ITEM_INCLUDE });
}

export async function updateItem(client, id, patch, { actorId = null } = {}) {
  const existing = await client.libraryItem.findUnique({ where: { id } });
  must(existing, 'not_found', 404);

  const data = { updatedById: actorId };
  if ('internalName' in patch) {
    const v = String(patch.internalName || '').trim();
    must(v, 'internal_name_required');
    data.internalName = v;
  }
  if ('contentType' in patch) {
    must(CONTENT_TYPES.includes(patch.contentType), 'invalid_content_type');
    data.contentType = patch.contentType;
  }
  for (const k of [
    'description',
    'publicTitleHe',
    'publicTitleEn',
    'publicDescriptionHe',
    'publicDescriptionEn',
  ]) {
    if (k in patch) data[k] = String(patch[k] || '').trim() || null;
  }
  if ('language' in patch) data.language = patch.language || null;
  if ('archived' in patch) data.archived = !!patch.archived;
  if ('mediaId' in patch) data.mediaId = patch.mediaId || null;

  // Resolve the world set FIRST — the categories about to be written are
  // validated against it, and both are validated before anything is saved.
  let worldIds = null;
  if ('worldIds' in patch) {
    worldIds = await resolveWorldIds(client, patch.worldIds);
  }
  if ('categoryIds' in patch) {
    const effective =
      worldIds ||
      (await client.libraryItemWorld.findMany({ where: { itemId: id }, select: { worldId: true } }))
        .map((w) => w.worldId);
    await assertCategoriesMatchWorlds(client, { categoryIds: patch.categoryIds, worldIds: effective });
  }

  await client.libraryItem.update({ where: { id }, data });

  if (worldIds) {
    await setItemWorlds(client, id, worldIds);
    // Dropping a world must not leave that world's categories attached — the
    // link would violate the invariant the moment it was written. The API
    // surfaces what will be lost BEFORE the save (see the route), so this is
    // the confirmed consequence, not a surprise.
    await pruneCategoriesOutsideWorlds(client, id, worldIds);
  }
  if ('categoryIds' in patch) await setCategories(client, id, patch.categoryIds);
  if ('workspaceIds' in patch) {
    const ws = await primaryWorkspace(client);
    await setWorkspaces(client, id, patch.workspaceIds, ws?.id);
  }
  return client.libraryItem.findUnique({ where: { id }, include: ITEM_INCLUDE });
}

export async function getItem(client, id) {
  const item = await client.libraryItem.findUnique({ where: { id }, include: ITEM_INCLUDE });
  if (!item) return null;
  const transcript = item.mediaId
    ? await client.mediaTranscript.findFirst({
        where: { mediaId: item.mediaId, isCurrent: true },
      })
    : null;
  const history = item.mediaId
    ? await client.mediaTranscript.findMany({
        where: { mediaId: item.mediaId, isCurrent: false },
        orderBy: { generatedAt: 'desc' },
        select: { id: true, provider: true, model: true, generatedAt: true, language: true },
      })
    : [];
  return { ...item, transcript, transcriptHistory: history };
}

/**
 * Search + filter.
 *
 * Search spans the operator's own words (internal name, description), the
 * provider's words (source title) and — when one exists — the TRANSCRIPT. That
 * last one is the reason this is worth having: finding the recording where
 * someone said a thing is the actual job, and a filename never helps with it.
 *
 * Plain canonical search, no vector/AI layer (nothing in the estate makes that
 * trivial today).
 */
export async function listItems(client, filters = {}) {
  const {
    search = '',
    categoryId = null,
    worldId = null,
    contentType = null,
    sourceProvider = null,
    workspaceId = null,
    includeArchived = false,
    take = 200,
  } = filters;

  const q = String(search || '').trim();
  const where = {
    ...(includeArchived ? {} : { archived: false }),
    ...(categoryId ? { categories: { some: { categoryId } } } : {}),
    // Filtering by world is hierarchical: pick a world, and only that world's
    // content (and therefore only its categories) is in scope.
    ...(worldId ? { worlds: { some: { worldId } } } : {}),
    ...(contentType ? { contentType } : {}),
    ...(workspaceId ? { workspaces: { some: { workspaceId } } } : {}),
    ...(sourceProvider
      ? sourceProvider === 'r2'
        ? { media: { is: { storageStrategy: { in: ['r2_native', 'mirrored_to_r2'] } } } }
        : { media: { is: { sourceProvider } } }
      : {}),
    ...(q
      ? {
          OR: [
            { internalName: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { media: { is: { sourceTitle: { contains: q, mode: 'insensitive' } } } },
            { media: { is: { originalFileName: { contains: q, mode: 'insensitive' } } } },
            { categories: { some: { category: { nameHe: { contains: q, mode: 'insensitive' } } } } },
            {
              media: {
                is: {
                  transcripts: {
                    some: { isCurrent: true, text: { contains: q, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const items = await client.libraryItem.findMany({
    where,
    include: ITEM_INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Number(take) || 200, 500),
  });
  if (items.length === 0) return [];

  // Transcript state per item, resolved in ONE query rather than per row.
  const mediaIds = items.map((i) => i.mediaId).filter(Boolean);
  const [transcripts, jobs] = await Promise.all([
    mediaIds.length
      ? client.mediaTranscript.findMany({
          where: { mediaId: { in: mediaIds }, isCurrent: true },
          select: { mediaId: true, generatedAt: true },
        })
      : [],
    mediaIds.length
      ? client.mediaJob.findMany({
          where: { mediaId: { in: mediaIds }, kind: 'transcribe' },
          orderBy: { createdAt: 'desc' },
          select: { mediaId: true, status: true, lastError: true },
        })
      : [],
  ]);
  const tByMedia = new Map(transcripts.map((t) => [t.mediaId, t]));
  const jByMedia = new Map();
  for (const j of jobs) if (!jByMedia.has(j.mediaId)) jByMedia.set(j.mediaId, j);

  return items.map((i) => ({
    ...i,
    transcriptState: transcriptState(i, tByMedia.get(i.mediaId), jByMedia.get(i.mediaId)),
  }));
}

/**
 * The honest transcript state of an item.
 *
 * Never reports success because a job was merely queued, and never shows a bare
 * "failed" — a failure carries the reason forward so the operator can act on it.
 */
export function transcriptState(item, transcript, job) {
  if (transcript) return { status: 'completed', at: transcript.generatedAt, error: null };
  if (job && (job.status === 'queued' || job.status === 'running')) {
    return { status: job.status === 'running' ? 'processing' : 'queued', error: null };
  }
  if (job && job.status === 'failed') return { status: 'failed', error: job.lastError || null };
  if (!TRANSCRIBABLE_TYPES.includes(item.contentType)) {
    return { status: 'unavailable', error: null };
  }
  return { status: 'not_started', error: null };
}

/** Archive rather than delete — historical references stay readable. */
export async function setItemArchived(client, id, archived, { actorId = null } = {}) {
  return client.libraryItem.update({
    where: { id },
    data: { archived: !!archived, updatedById: actorId },
  });
}

export { prisma };
