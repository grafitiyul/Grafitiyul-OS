import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';

// OpenAI transcription provider — ONE chunk per request.
//
// ── The 25 MB limit is the PROVIDER's, not the product's ────────────────────
// This module used to refuse any media over 25 MB, which made long lectures and
// meeting recordings untranscribable. That was the wrong layer to solve it in.
// The provider limit still exists and is still respected here, but the pipeline
// (pipeline.js) now guarantees every request is a ~10-minute, ~2.4 MB speech
// chunk. There is no user-facing file-size or duration limit any more.
//
// ── The lesson inherited from the recruitment system ────────────────────────
// Its code carries a hard-won warning: hand Whisper a long stream and it
// transcribes roughly the first minute and SILENTLY DISCARDS the rest, which
// looks like success. That is why chunks here are produced by ffmpeg as
// independently-decodable audio files (never byte slices) and why an empty
// result is treated as a failure rather than as a finished transcript.

export const PROVIDER = 'openai';
export const DEFAULT_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

// The provider's documented per-request ceiling. An internal assertion, not a
// product rule: if a chunk ever approaches this, the chunk length is wrong.
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
    optionalEnv: ['OPENAI_TRANSCRIBE_MODEL', 'TRANSCRIBE_CHUNK_SECONDS'],
    note: 'תמלול דרך OpenAI. קבצים גדולים מפוצלים אוטומטית — אין מגבלת גודל למשתמש.',
  };
}

/**
 * Can this media be transcribed at all, and why not when it cannot?
 *
 * Pure — no network, no storage, no size rule. SIZE IS DELIBERATELY NOT A
 * REASON any more: the pipeline chunks whatever it is given. The only genuine
 * blockers are "there is no speech track" and "we do not hold the bytes".
 */
export function transcribability(media) {
  if (!media) return { ok: false, reason: 'media_not_found' };
  if (!['video', 'audio'].includes(media.mediaType)) {
    return { ok: false, reason: 'not_audio_or_video' };
  }
  // An external reference has no bytes we may lawfully fetch. YouTube in
  // particular is reference-only by decision — we do NOT download media merely
  // to transcribe it. A Vimeo item MIRRORED to R2 has an objectKey and passes.
  if (!media.objectKey) {
    return {
      ok: false,
      reason:
        media.sourceProvider === 'youtube'
          ? 'youtube_reference_has_no_media'
          : 'external_reference_has_no_media',
    };
  }
  return { ok: true };
}

// Hand-built multipart, matching the proven recruitment approach — deliberately
// not an SDK, so the request shape stays visible and stable.
function buildMultipart({ fileBuffer, fileName, model, language, responseFormat }) {
  const boundary = `----GrafitiyulMedia${Date.now().toString(16)}`;
  const CRLF = '\r\n';
  const field = (name, value) =>
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`,
    );
  const parts = [field('model', model)];
  if (language) parts.push(field('language', language));
  parts.push(field('response_format', responseFormat));
  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
        `Content-Type: audio/mpeg${CRLF}${CRLF}`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
  return { body: Buffer.concat(parts), boundary };
}

/**
 * Transcribe ONE audio chunk from local disk.
 *
 * `verbose_json` is requested so segment timestamps are captured from the first
 * run — future chapter/seek/speaker features then need no re-transcription of
 * the archive. (The recruitment system used plain `text`, which is exactly why
 * it can never add timestamps retroactively.)
 *
 * Errors carry `retryable` so the pipeline can distinguish "try again in a
 * moment" (429/5xx) from "this will never work" (400), and retry only the
 * former.
 */
export async function transcribeFile(filePath, { language = null, fetchImpl = fetch } = {}) {
  if (!isConfigured()) {
    const err = new Error('transcription_not_configured');
    err.retryable = false;
    throw err;
  }
  const fileBuffer = await fs.readFile(filePath);
  if (fileBuffer.length === 0) {
    const err = new Error('empty_audio_chunk');
    err.retryable = false;
    throw err;
  }
  // Internal assertion. Reaching this means the chunk length is misconfigured;
  // it is a bug to fix, not a limit to show a user.
  if (fileBuffer.length > MAX_REQUEST_BYTES) {
    const err = new Error(
      `chunk_exceeds_provider_limit (${fileBuffer.length} > ${MAX_REQUEST_BYTES}) — lower TRANSCRIBE_CHUNK_SECONDS`,
    );
    err.retryable = false;
    throw err;
  }

  const { body, boundary } = buildMultipart({
    fileBuffer,
    fileName: path.basename(filePath),
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
    err.retryable = res.status === 429 || res.status >= 500;
    err.status = res.status;
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
  return {
    // An empty chunk is legitimate here (a silent stretch of a recording) and is
    // NOT an error at the chunk level — the pipeline decides whether a whole
    // transcript came back empty.
    text,
    segments: Array.isArray(parsed?.segments)
      ? parsed.segments.map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || '').trim(),
        }))
      : null,
    language: parsed?.language || language || null,
    durationSeconds: Number.isFinite(parsed?.duration) ? parsed.duration : null,
    provider: PROVIDER,
    model: DEFAULT_MODEL,
  };
}
