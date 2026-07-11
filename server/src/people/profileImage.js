import { detectMime, kindOfMime } from '../media/detectMime.js';

// Shared profile-photo storage — the ONE pipeline both the admin route
// (people.js POST /:id/image) and the guide portal photo route use.
// Images live in MediaAsset (served publicly at /api/media/:id, immutable).
// Old assets are NEVER deleted here — the profile just points elsewhere, so
// profile history can always preview previous photos.

export const MAX_PROFILE_IMAGE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Validates the buffer and stores image + profile pointer atomically.
// Returns { error } on rejection, or { url, assetId, previousUrl } on success.
export async function storeProfileImage(client, personRefId, { body, filename }) {
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

  const result = await client.$transaction(async (tx) => {
    const previous = await tx.personProfile.findUnique({
      where: { personRefId },
      select: { imageUrl: true },
    });
    const asset = await tx.mediaAsset.create({
      data: {
        kind: 'image',
        mimeType: mime,
        filename: String(filename || 'profile').slice(0, 200),
        byteSize: body.length,
        bytes: body,
      },
      select: { id: true },
    });
    const url = `/api/media/${asset.id}`;
    await tx.personProfile.upsert({
      where: { personRefId },
      update: { imageUrl: url },
      create: { personRefId, imageUrl: url },
    });
    return { url, assetId: asset.id, previousUrl: previous?.imageUrl || null };
  });
  return result;
}
