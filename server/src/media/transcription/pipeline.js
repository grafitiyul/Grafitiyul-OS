import * as r2 from '../../r2.js';
import { saveTranscript } from '../transcripts.js';
import * as openai from './openai.js';
import {
  CHUNK_SECONDS,
  chunkSize,
  createWorkdir,
  extractAudioChunks,
  probeMedia,
  releaseWorkdir,
} from './ffmpeg.js';

// THE large-media transcription pipeline.
//
// Operator experience: click "תמלול", get the whole transcript — whatever the
// file size. Internally:
//
//   preparing_media  presign the R2 object (bytes stay in R2)
//   chunking         ffmpeg reads that URL and emits ~10-min speech-audio
//                    chunks in one pass; one MediaTranscriptChunk row per chunk
//   transcribing     each PENDING chunk is sent to the provider, bounded
//                    concurrency, retried individually
//   assembling       chunks ordered by index, timestamps shifted to absolute
//                    time, ONE MediaTranscript version written
//
// ── Why this survives anything ──────────────────────────────────────────────
// Progress lives in MediaTranscriptChunk rows, never in process memory. A
// deploy, crash or provider timeout at chunk 47 of 50 costs those unfinished
// chunks only — the 46 already stored are never re-sent and never re-paid for.
// Re-entering the pipeline for the same job simply resumes.

export const STAGES = Object.freeze({
  preparing: 'preparing_media',
  chunking: 'chunking',
  transcribing: 'transcribing',
  assembling: 'assembling',
});

// Bounded so several large videos cannot exhaust the service or trip provider
// rate limits. The recruitment system's own code carries a comment about 429
// cascades from firing too many at once.
export const CHUNK_CONCURRENCY = Number(process.env.TRANSCRIBE_CONCURRENCY || 3);
const MAX_CHUNK_ATTEMPTS = Number(process.env.TRANSCRIBE_CHUNK_ATTEMPTS || 3);

async function setStage(client, jobId, stage, patch = {}) {
  await client.mediaJob.update({ where: { id: jobId }, data: { stage, ...patch } });
}

async function isCancelled(client, jobId) {
  const j = await client.mediaJob.findUnique({
    where: { id: jobId },
    select: { cancelRequested: true },
  });
  return !!j?.cancelRequested;
}

/**
 * Plan the chunks — idempotently.
 *
 * If chunk rows already exist for this job we are RESUMING, so ffmpeg is not
 * re-run and the existing plan (and its completed work) is kept. This is what
 * makes a restart cheap instead of catastrophic.
 */
async function ensureChunkPlan(client, job, workdir, log) {
  const existing = await client.mediaTranscriptChunk.findMany({
    where: { jobId: job.id },
    orderBy: { index: 'asc' },
  });

  // Audio files live in a temp dir that does NOT survive a restart, so a resume
  // must re-extract even though the row plan is kept. The rows carry the
  // completed TEXT, so re-extraction costs CPU, never provider calls.
  const media = job.media;
  if (!r2.isConfigured()) {
    const e = new Error('r2_not_configured');
    e.retryable = false;
    throw e;
  }
  const url = await r2.presignGet({ key: media.objectKey, expiresIn: 6 * 3600 });

  await setStage(client, job.id, STAGES.preparing);
  const probe = await probeMedia(url);
  if (!probe.hasAudio) {
    const e = new Error('media_has_no_audio_track');
    e.retryable = false;
    throw e;
  }

  await setStage(client, job.id, STAGES.chunking);
  const files = await extractAudioChunks(url, workdir, { chunkSeconds: CHUNK_SECONDS });
  if (files.length === 0) {
    const e = new Error('audio_extraction_produced_no_chunks');
    e.retryable = false;
    throw e;
  }

  // Clamp the final boundary to the real duration so the last chunk does not
  // claim time that does not exist.
  if (probe.durationSeconds) {
    const last = files[files.length - 1];
    last.endSeconds = Math.min(last.endSeconds, probe.durationSeconds);
  }

  if (existing.length === 0) {
    await client.mediaTranscriptChunk.createMany({
      data: files.map((f) => ({
        jobId: job.id,
        mediaId: job.mediaId,
        index: f.index,
        startSeconds: f.startSeconds,
        endSeconds: f.endSeconds,
      })),
      skipDuplicates: true,
    });
    log.log?.(`[transcribe] ${job.id}: planned ${files.length} chunk(s) of ${CHUNK_SECONDS}s`);
  } else if (existing.length !== files.length) {
    // The source changed underneath a resumed job. Trusting the old plan would
    // assemble a transcript from mismatched slices, so fail loudly instead.
    const e = new Error(
      `chunk_plan_mismatch_on_resume (had ${existing.length}, extracted ${files.length})`,
    );
    e.retryable = false;
    throw e;
  } else {
    log.log?.(`[transcribe] ${job.id}: resuming existing plan of ${files.length} chunk(s)`);
  }

  await client.mediaJob.update({
    where: { id: job.id },
    data: { progressTotal: files.length },
  });
  return { files, durationSeconds: probe.durationSeconds };
}

/** Transcribe every not-yet-done chunk, with bounded concurrency. */
async function transcribeOutstanding(client, job, files, language, log) {
  await setStage(client, job.id, STAGES.transcribing);

  const byIndex = new Map(files.map((f) => [f.index, f]));
  const pending = await client.mediaTranscriptChunk.findMany({
    where: { jobId: job.id, status: { in: ['pending', 'failed', 'running'] } },
    orderBy: { index: 'asc' },
  });

  let cursor = 0;
  let cancelled = false;

  const worker = async () => {
    for (;;) {
      if (cancelled) return;
      const row = pending[cursor++];
      if (!row) return;
      if (row.attempts >= MAX_CHUNK_ATTEMPTS) continue; // settled as failed

      // Cooperative cancellation: checked between chunks so a cancel never
      // kills a request mid-flight and never leaves a half-written chunk.
      if (await isCancelled(client, job.id)) {
        cancelled = true;
        return;
      }

      const file = byIndex.get(row.index)?.file;
      if (!file) continue;

      await client.mediaTranscriptChunk.update({
        where: { id: row.id },
        data: { status: 'running', attempts: { increment: 1 } },
      });
      try {
        const out = await openai.transcribeFile(file, { language });
        await client.mediaTranscriptChunk.update({
          where: { id: row.id },
          data: {
            status: 'done',
            text: out.text,
            segments: out.segments || undefined,
            lastError: null,
            completedAt: new Date(),
          },
        });
        const done = await client.mediaTranscriptChunk.count({
          where: { jobId: job.id, status: 'done' },
        });
        await client.mediaJob.update({
          where: { id: job.id },
          data: { progressDone: done },
        });
      } catch (e) {
        const permanent = e?.retryable === false;
        await client.mediaTranscriptChunk.update({
          where: { id: row.id },
          data: {
            // A retryable failure returns to 'pending' so the next pass picks it
            // up; a permanent one settles now rather than burning attempts.
            status: permanent ? 'failed' : 'pending',
            lastError: String(e?.message || e).slice(0, 400),
          },
        });
        log.warn?.(`[transcribe] ${job.id} chunk ${row.index} failed: ${e?.message || e}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, Math.max(pending.length, 1)) }, worker),
  );
  return { cancelled };
}

/**
 * Assemble the final transcript.
 *
 * Ordered by chunk INDEX, never by completion time — chunks finish out of order
 * under concurrency, and ordering by completion would silently scramble a
 * lecture. Segment timestamps are shifted by the chunk's absolute start so the
 * assembled transcript describes the original timeline.
 */
export function assembleTranscript(chunks) {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const texts = [];
  const segments = [];
  for (const c of ordered) {
    if (c.text) texts.push(c.text.trim());
    for (const s of c.segments || []) {
      segments.push({
        start: Number(s.start || 0) + Number(c.startSeconds || 0),
        end: Number(s.end || 0) + Number(c.startSeconds || 0),
        text: s.text,
      });
    }
  }
  return {
    text: texts.filter(Boolean).join('\n\n'),
    segments: segments.length ? segments : null,
  };
}

/**
 * Run (or resume) transcription for one job.
 *
 * Returns { status: 'completed' | 'cancelled' | 'incomplete', ... }. It NEVER
 * writes a transcript unless every chunk succeeded — a partial result is
 * reported as incomplete with the failing chunks named, never stored as a
 * finished transcript.
 */
export async function runTranscription(client, job, { log = console } = {}) {
  const media = job.media;
  const can = openai.transcribability(media);
  if (!can.ok) {
    const e = new Error(can.reason);
    e.retryable = false;
    throw e;
  }

  let workdir = null;
  try {
    workdir = await createWorkdir(job.id);
    const { files, durationSeconds } = await ensureChunkPlan(client, job, workdir, log);

    // Guard the provider limit at the point it is actually knowable.
    const oversize = files.filter((f) => chunkSize(f.file) > openai.MAX_REQUEST_BYTES);
    if (oversize.length) {
      const e = new Error(
        `chunk_too_large_for_provider (${oversize.length} chunk(s)) — lower TRANSCRIBE_CHUNK_SECONDS`,
      );
      e.retryable = false;
      throw e;
    }

    const language = job.payload?.language || null;
    const { cancelled } = await transcribeOutstanding(client, job, files, language, log);
    if (cancelled) return { status: 'cancelled' };

    const all = await client.mediaTranscriptChunk.findMany({
      where: { jobId: job.id },
      orderBy: { index: 'asc' },
    });
    const notDone = all.filter((c) => c.status !== 'done');
    if (notDone.length) {
      // Honest incompleteness. The finished chunks stay in the database, so the
      // retry transcribes only what is missing.
      return {
        status: 'incomplete',
        total: all.length,
        done: all.length - notDone.length,
        failedIndexes: notDone.map((c) => c.index),
        reason: notDone.find((c) => c.lastError)?.lastError || 'chunks_incomplete',
      };
    }

    await setStage(client, job.id, STAGES.assembling);
    const { text, segments } = assembleTranscript(all);
    if (!text.trim()) {
      // Every chunk succeeded and the whole recording is silent — a failure
      // worth reporting, not an empty transcript worth storing.
      const e = new Error('transcription_returned_empty');
      e.retryable = false;
      throw e;
    }

    const transcript = await saveTranscript(client, {
      mediaId: media.id,
      text,
      segments,
      language,
      provider: openai.PROVIDER,
      model: openai.DEFAULT_MODEL,
      sourceObjectKey: media.objectKey,
      sourceChecksum: media.checksum || null,
      durationSeconds: durationSeconds || media.durationSeconds || null,
      requestedById: job.requestedById,
    });

    if (durationSeconds && !media.durationSeconds) {
      await client.tourMedia.update({
        where: { id: media.id },
        data: { durationSeconds },
      });
    }
    log.log?.(
      `[transcribe] ${job.id}: completed — ${all.length} chunk(s), ${text.length} chars`,
    );
    return { status: 'completed', transcriptId: transcript.id, chunks: all.length };
  } finally {
    // Temporary audio ALWAYS goes, on success, failure and cancellation alike.
    // The chunk ROWS survive (that is the resumable progress); only the bytes
    // are disposable, and leaving them would slowly fill the Railway disk.
    try {
      await releaseWorkdir(workdir);
    } catch (e) {
      log.warn?.(`[transcribe] ${job.id}: temp cleanup failed: ${e?.message || e}`);
    }
  }
}
