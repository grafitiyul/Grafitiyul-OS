// Client-side cap before we hit the network. Server rejects above these too.
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

export async function uploadMedia(file, kind) {
  if (!file) throw new Error('no file');
  if (kind !== 'image' && kind !== 'video') throw new Error('invalid kind');

  const allowed = kind === 'image' ? ALLOWED_IMAGE_MIME : ALLOWED_VIDEO_MIME;
  if (!allowed.has(file.type)) {
    throw new Error(`סוג קובץ לא נתמך: ${file.type || 'לא ידוע'}`);
  }

  const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    throw new Error(`הקובץ גדול מדי. מקסימום ${mb}MB.`);
  }

  const qs = new URLSearchParams({ kind, filename: file.name || 'file' });
  const res = await fetch(`/api/media/upload?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    cache: 'no-store',
    body: file,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text || 'העלאה נכשלה'}`);
  }
  return res.json(); // { id, kind, mimeType, filename, byteSize, url }
}
