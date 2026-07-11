import { detectMime, kindOfMime } from '../media/detectMime.js';

// Shared profile-photo storage — the ONE pipeline both the admin route
// (people.js) and the guide portal photo route use. Images live in
// MediaAsset (served publicly at /api/media/:id, immutable). Old assets are
// NEVER deleted here — the profile just points elsewhere, so profile history
// can always preview previous photos.
//
// Two-step avatar flow (shared crop tool):
//   1. storeImageAsset(original)  → asset only, profile untouched
//   2. storeProfileImage(rendition, { originalUrl, crop }) → sets the
//      canonical avatar + keeps the original + crop metadata for recrop.
// A plain upload (no crop step) passes no originalUrl — the rendition then
// doubles as its own original.

export const MAX_PROFILE_IMAGE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

function validateImage(body) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return { error: 'empty_body', status: 400 };
  }
  if (body.length > MAX_PROFILE_IMAGE) {
    return { error: 'too_large', status: 413 };
  }
  const mime = detectMime(body);
  if (!mime || kindOfMime(mime) !== 'image' || !ALLOWED_IMAGE.has(mime)) {
    return { error: 'unsupported_or_corrupt_image', status: 400 };
  }
  return { mime };
}

async function createAsset(client, { body, mime, filename }) {
  const asset = await client.mediaAsset.create({
    data: {
      kind: 'image',
      mimeType: mime,
      filename: String(filename || 'profile').slice(0, 200),
      byteSize: body.length,
      bytes: body,
    },
    select: { id: true },
  });
  return { assetId: asset.id, url: `/api/media/${asset.id}` };
}

// Store an image WITHOUT touching the profile (the crop flow's original).
export async function storeImageAsset(client, { body, filename }) {
  const v = validateImage(body);
  if (v.error) return v;
  return createAsset(client, { body, mime: v.mime, filename });
}

// Normalize crop metadata — { x, y, zoom } numbers only, or null.
export function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const zoom = Number(crop.zoom);
  if (![x, y, zoom].every(Number.isFinite)) return null;
  return { x, y, zoom };
}

// Store the canonical avatar rendition and point the profile at it.
export async function storeProfileImage(
  client,
  personRefId,
  { body, filename, originalUrl = null, crop = null },
) {
  const v = validateImage(body);
  if (v.error) return v;

  const result = await client.$transaction(async (tx) => {
    const previous = await tx.personProfile.findUnique({
      where: { personRefId },
      select: { imageUrl: true },
    });
    const rendition = await createAsset(tx, { body, mime: v.mime, filename });
    const data = {
      imageUrl: rendition.url,
      imageOriginalUrl: originalUrl || rendition.url,
      imageCrop: normalizeCrop(crop),
    };
    await tx.personProfile.upsert({
      where: { personRefId },
      update: data,
      create: { personRefId, ...data },
    });
    return { ...rendition, previousUrl: previous?.imageUrl || null };
  });
  return result;
}
