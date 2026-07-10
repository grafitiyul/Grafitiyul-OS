// Questionnaire answer uploads — validation + storage glue (Slice 5).
//
// Storage rides the existing MediaAsset table (immutable bytes, unguessable
// cuid id, served by GET /api/media/:id with content-addressed immutable
// caching — safe under the freshness rules). This module owns WHAT a
// questionnaire answer may upload: images (magic-byte sniffed, same detector
// the learning media uses) + PDF. Both the staff and the public upload routes
// funnel through here so the policy exists exactly once.

import { prisma } from '../db.js';
import { detectMime } from '../media/detectMime.js';
import { QError } from './service.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — form answers, not media library

const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function isPdf(buffer) {
  return buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

// buffer + declared filename → { mime, kind } | QError
export function sniffQuestionnaireUpload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new QError(400, 'empty_file');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new QError(413, 'file_too_large');
  if (isPdf(buffer)) return { mime: 'application/pdf', kind: 'file' };
  const mime = detectMime(buffer);
  if (mime && ALLOWED_IMAGE.has(mime)) return { mime, kind: 'image' };
  throw new QError(400, 'unsupported_file_type');
}

// Store and return the ANSWER VALUE shape ({ assetId, url, name, mime, size }).
export async function storeQuestionnaireUpload(buffer, filename) {
  const { mime, kind } = sniffQuestionnaireUpload(buffer);
  const name = String(filename || 'file').slice(0, 200);
  const asset = await prisma.mediaAsset.create({
    data: {
      kind,
      mimeType: mime,
      filename: name,
      byteSize: buffer.length,
      bytes: buffer,
    },
    select: { id: true },
  });
  return {
    assetId: asset.id,
    url: `/api/media/${asset.id}`,
    name,
    mime,
    size: buffer.length,
  };
}
