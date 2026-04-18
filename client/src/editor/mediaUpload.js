// Client caps. Server also validates, but we reject early to avoid
// burning bandwidth on a file we know the server will refuse.
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

// Upload with real progress events. Uses XMLHttpRequest because `fetch` has
// no built-in upload-progress API. Returns a Promise<AssetResponse>.
// The returned Promise also has an `abort()` method to cancel mid-upload.
export function uploadMediaWithProgress(file, kind, onProgress) {
  if (!file) return Promise.reject(new Error('no file'));
  if (kind !== 'image' && kind !== 'video') {
    return Promise.reject(new Error('invalid kind'));
  }

  const allowed = kind === 'image' ? ALLOWED_IMAGE_MIME : ALLOWED_VIDEO_MIME;
  if (!allowed.has(file.type)) {
    return Promise.reject(
      new Error(`סוג קובץ לא נתמך: ${file.type || 'לא ידוע'}`),
    );
  }

  const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    return Promise.reject(new Error(`הקובץ גדול מדי. מקסימום ${mb}MB.`));
  }

  const xhr = new XMLHttpRequest();
  const qs = new URLSearchParams({
    kind,
    filename: file.name || 'file',
  });

  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', `/api/media/upload?${qs.toString()}`);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.addEventListener('progress', (e) => {
      if (!onProgress) return;
      if (e.lengthComputable) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      } else {
        // Server didn't report total — emit indeterminate progress.
        onProgress({ loaded: e.loaded, total: null, percent: null });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('תגובה לא חוקית מהשרת'));
        }
      } else {
        let msg = `${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j?.error) msg = j.error;
        } catch {
          if (xhr.responseText) msg = xhr.responseText;
        }
        reject(new Error(msg));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('שגיאת רשת')));
    xhr.addEventListener('abort', () => reject(new Error('bcancel')));
    xhr.send(file);
  });

  promise.abort = () => xhr.abort();
  return promise;
}

import { parseEmbedUrl } from './embedProviders.js';

// Typed result for the video-URL flow. The dialog consumer picks the right
// insertion path based on `kind`:
//   { ok: true, kind: 'embed', provider, videoId, embedUrl }
//   { ok: true, kind: 'direct', url }
//   { ok: false, error }
export function validateExternalVideoUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return { ok: false, error: 'יש להזין כתובת' };

  // Try YouTube / Vimeo first — those become an iframe embed.
  const embed = parseEmbedUrl(raw);
  if (embed) return { ok: true, kind: 'embed', ...embed };

  // Otherwise accept only http(s) direct URLs.
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'כתובת לא תקינה' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'יש להשתמש ב-http או https' };
  }
  // Known platform host we couldn't parse — reject with a clear message so the
  // user knows we tried but the URL format wasn't recognised.
  const host = u.hostname.toLowerCase();
  if (
    host.endsWith('youtube.com') ||
    host === 'youtu.be' ||
    host.endsWith('vimeo.com')
  ) {
    return {
      ok: false,
      error: 'לא הצלחנו לזהות מזהה וידאו בכתובת. ודאו שמדובר בקישור תקין.',
    };
  }
  return { ok: true, kind: 'direct', url: raw };
}
