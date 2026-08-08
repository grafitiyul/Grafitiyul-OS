import { Buffer } from 'node:buffer';
import * as r2 from '../../r2.js';

// OpenAI transcription provider.
//
// ── The lesson inherited from the recruitment system ────────────────────────
// Its code carries a hard-won warning: handing Whisper a long concatenated
// stream transcribes only the first ~60 seconds and SILENTLY DISCARDS the rest,
// producing a short transcript that looks successful. Their answer was to
// record in ~60s segments and transcribe each independently.
//
// GOS cannot reuse that: our media is a single finished object in R2, not a
// stream of client-recorded chunks. So the same lesson is applied differently —
// we respect the provider's real limit by SIZE, refuse anything we cannot
// honestly split, and never report a partial result as complete.
//
// The API limit is 25 MB per request. A file under that is sent whole. A file
// over it cannot be safely split here: cutting a compressed audio/video
// container at an arbitrary byte offset produces fragments that are not
// decodable, and no audio re-encoder (ffmpeg) exists in this deployment. Rather
// than send a corrupt fragment and store whatever came back, the job fails with
// a reason the operator can act on.
//
// Env: OPENAI_API_KEY. Absent → isConfigured() false and the UI shows an honest
// "not configured" state.

export const PROVIDER = 'openai';
export const DEFAULT_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

// OpenAI's documented ceiling for /v1/audio/transcriptions.
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export function isConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

export function configHint() {
  return {
    provider: PROVIDER,
    configured: isConfigured(),
    model: DEFAULT_MODEL,
    requiredEnv: ['OPENAI_API_KEY'],
    optionalEnv: ['OPENAI_TRANSCRIBE_MODEL'],
    maxRequestBytes: MAX_REQUEST_BYTES,
    note: 'תמלול דרך OpenAI. קובץ גדול מ-25MB נדחה במפורש עם סיבה, ולא מתומלל חלקית.',
  };
}

/**
 * Whether this media can be transcribed at all, and why not when it cannot.
 * Pure — no network, no storage. The UI uses this to decide whether "תמלל" is
 * even offered, so the button never appears for something that must fail.
 */
export function transcribability(media) {
  if (!media) return { ok: false, reason: 'media_not_found' };
  if (!['video', 'audio'].includes(media.mediaType)) {
    return { ok: false, reason: 'not_audio_or_video' };
  }
  // An external reference has no bytes we may lawfully fetch through this
  // provider. YouTube in particular is reference-only by decision — we do NOT
  // download media merely to transcribe it.
  if (!media.objectKey) {
    return {
      ok: false,
      reason:
        media.sourceProvider === 'youtube'
          ? 'youtube_reference_has_no_media'
          : 'external_reference_has_no_media',
    };
  }
  const size = media.byteSize == null ? null : Number(media.byteSize);
  if (size != null && size > MAX_REQUEST_BYTES) {
    return { ok: false, reason: 'file_too_large_for_provider', size, limit: MAX_REQUEST_BYTES };
  }
  return { ok: true };
}

// Multipart body built by hand, matching the proven recruitment approach —
// deliberately not an SDK, so the request shape is visible and stable.
function buildMultipart({ fileBuffer, fileName, mimeType, model, language, responseFormat }) {
  const boundary = `----GrafitiyulMedia${Date.now().toString(16)}`;
  const CRLF = '\r\n';
  const parts = [];
  const field = (name, value) =>
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`,
    );
  parts.push(field('model', model));
  if (language) parts.push(field('language', language));
  parts.push(field('response_format', responseFormat));
  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
        `Content-Type: ${mimeType || 'application/octet-stream'}${CRLF}${CRLF}`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
  return { body: Buffer.concat(parts), boundary };
}

/**
 * Transcribe ONE media object stored in R2.
 *
 * `verbose_json` is requested so segments/timestamps are captured from day one
 * — the future timestamp, chapter and speaker features then need no
 * re-transcription of the whole archive. (The recruitment system used plain
 * `text`, which is why it can never add timestamps retroactively.)
 */
export async function transcribeMedia(media, { language = null, fetchImpl = fetch, storage = r2 } = {}) {
  if (!isConfigured()) {
    const err = new Error('transcription_not_configured');
    err.status = 503;
    throw err;
  }
  const can = transcribability(media);
  if (!can.ok) {
    const err = new Error(can.reason);
    err.status = 422;
    throw err;
  }
  if (!storage.isConfigured()) {
    const err = new Error('r2_not_configured');
    err.status = 503;
    throw err;
  }

  // Read the object from R2 into memory. Bounded by the 25MB provider limit
  // that transcribability() already enforced, so this cannot balloon.
  const head = await storage.headObject(media.objectKey);
  if (!head) {
    const err = new Error('media_object_missing');
    err.status = 422;
    throw err;
  }
  if (head.size > MAX_REQUEST_BYTES) {
    const err = new Error('file_too_large_for_provider');
    err.status = 422;
    throw err;
  }
  const fileBuffer = await storage.getObjectRange(media.objectKey, 0, head.size - 1);

  const { body, boundary } = buildMultipart({
    fileBuffer,
    fileName: media.originalFileName || 'media',
    mimeType: media.mimeType,
    model: DEFAULT_MODEL,
    language,
    responseFormat: 'verbose_json',
  });

  const res = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const raw = await res.text();
  if (!res.ok) {
    let reason = `http_${res.status}`;
    try {
      reason = JSON.parse(raw)?.error?.message || reason;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(`transcription_provider_error: ${String(reason).slice(0, 300)}`);
    // 429/5xx are worth retrying; a 400 means this file will never work.
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('transcription_provider_returned_unparseable_body');
    err.retryable = false;
    throw err;
  }

  const text = String(parsed?.text ?? '').trim();
  // An empty transcript is NOT a success. Silent-audio and wrong-format files
  // both come back this way, and storing "" as a completed transcript would
  // present a failure as a finished job.
  if (!text) {
    const err = new Error('transcription_returned_empty');
    err.retryable = false;
    throw err;
  }

  return {
    text,
    segments: Array.isArray(parsed?.segments)
      ? parsed.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: String(s.text || '').trim(),
        }))
      : null,
    language: parsed?.language || language || null,
    durationSeconds: Number.isFinite(parsed?.duration) ? parsed.duration : null,
    provider: PROVIDER,
    model: DEFAULT_MODEL,
    sourceObjectKey: media.objectKey,
    sourceChecksum: head.etag || media.checksum || null,
  };
}
