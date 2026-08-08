import { prisma } from '../db.js';
import * as r2 from '../r2.js';
import { JOB_KINDS, claimJob, completeJob, failJob } from './jobs.js';
import * as openai from './transcription/openai.js';
import { runTranscription } from './transcription/pipeline.js';
import { ffmpegHealth } from './transcription/ffmpeg.js';
import * as vimeo from './providers/vimeo.js';
import { originalKey } from './keys.js';

// THE media processing worker — transcription and Vimeo→R2 mirroring.
//
// Durable by construction (see jobs.js): a job survives a deploy, is claimed
// exactly once by a guarded conditional update, retries with backoff, and
// settles as `failed` WITH A REASON rather than being retried forever or
// disappearing into a log.
//
// Deliberately serial: one job per tick per kind. These are long, bandwidth-
// heavy operations against rate-limited third parties, and the recruitment
// system's own code carries a comment about 429 cascades from running too many
// at once. Throughput is not the constraint here; not melting the provider is.

const TICK_MS = Number(process.env.MEDIA_WORKER_TICK_MS || 30_000);

async function runTranscribeJob(job, log) {
  const result = await runTranscription(prisma, job, { log });

  if (result.status === 'cancelled') {
    await prisma.mediaJob.update({
      where: { id: job.id },
      data: { status: 'cancelled', stage: null, completedAt: new Date() },
    });
    log.log?.(`[media-worker] transcription ${job.id} cancelled by operator`);
    // Signals "handled" — completeJob must not mark a cancelled job done.
    return { handled: true };
  }

  if (result.status === 'incomplete') {
    // NEVER stored as a finished transcript. The successful chunks stay in the
    // database, so the next attempt transcribes only what is still missing.
    const err = new Error(
      `transcription_incomplete: ${result.done}/${result.total} chunks — ${result.reason}`,
    );
    err.retryable = true;
    throw err;
  }
  return { handled: false };
}

/**
 * Copy a Vimeo source file INTO R2, converting the asset from an external
 * reference into a mirrored one.
 *
 * The file link is re-read from the API at run time and never persisted:
 * Vimeo's download URLs are short-lived, so a stored one would be a guaranteed
 * future failure. Bytes stream straight through to R2 — the API process never
 * buffers a video.
 */
async function runMirrorJob(job, log) {
  const media = job.media;
  if (media.sourceProvider !== 'vimeo') throw new Error('mirror_unsupported_provider');
  if (media.objectKey) {
    log.log?.(`[media-worker] ${media.id} already mirrored — nothing to do`);
    return;
  }
  if (!r2.isConfigured()) {
    const err = new Error('r2_not_configured');
    err.retryable = false;
    throw err;
  }

  const files = await vimeo.sourceFilesFor(media.sourceExternalId);
  if (!files.length) {
    // The account/token does not expose source files. This is a permanent
    // condition for this asset, not a transient one — retrying cannot help.
    const err = new Error('vimeo_no_source_file_exposed');
    err.retryable = false;
    throw err;
  }
  const best = files[0];
  const fileName = `${media.sourceExternalId}.${(best.mimeType || 'video/mp4').split('/')[1] || 'mp4'}`;
  const key = originalKey({ library: true }, media.id, fileName);

  const res = await fetch(best.link);
  if (!res.ok || !res.body) {
    const err = new Error(`vimeo_download_failed_http_${res.status}`);
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  const bytes = await r2.uploadStream({
    key,
    contentType: best.mimeType || 'video/mp4',
    body: res.body,
  });

  await prisma.tourMedia.update({
    where: { id: media.id },
    data: {
      objectKey: key,
      mimeType: best.mimeType || 'video/mp4',
      byteSize: BigInt(bytes),
      width: best.width || media.width,
      height: best.height || media.height,
      storageStrategy: 'mirrored_to_r2',
      mirroredAt: new Date(),
      // The row stays 'ready': it was already a usable reference, and the
      // mirror only changed WHERE the bytes live.
      uploadStatus: 'ready',
      completedAt: media.completedAt || new Date(),
    },
  });
  log.log?.(`[media-worker] mirrored vimeo ${media.sourceExternalId} → R2 (${bytes} bytes)`);
}

const HANDLERS = {
  [JOB_KINDS.transcribe]: runTranscribeJob,
  [JOB_KINDS.mirrorToR2]: runMirrorJob,
};

export async function runOnce(log = console) {
  for (const kind of Object.keys(HANDLERS)) {
    const job = await claimJob(prisma, { kind });
    if (!job) continue;
    try {
      const out = await HANDLERS[kind](job, log);
      // A handler that already settled the job (e.g. cancellation) must not be
      // overwritten with 'done'.
      if (!out?.handled) await completeJob(prisma, job.id);
    } catch (e) {
      // A permanently-impossible job is not retried: burning three attempts on
      // "this plan exposes no file" only delays the honest answer.
      const permanent = e?.retryable === false || e?.status === 422;
      if (permanent) {
        await prisma.mediaJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            lastError: String(e.message || e).slice(0, 500),
            completedAt: new Date(),
          },
        });
      } else {
        await failJob(prisma, job.id, e);
      }
      log.warn?.(`[media-worker] ${kind} job ${job.id} failed: ${e?.message || e}`);
    }
  }
}

export function startMediaWorker(log = console) {
  // The worker runs regardless of provider configuration: jobs must still be
  // claimed and settled with an honest "not configured" reason, rather than
  // sitting in `queued` forever looking like work in progress.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce(log);
    } catch (e) {
      log.warn?.(`[media-worker] tick failed: ${e?.message || e}`);
    } finally {
      running = false;
    }
  };
  setInterval(tick, TICK_MS).unref?.();
  log.log?.(
    `[media-worker] started (${TICK_MS / 1000}s tick) — transcription ${
      openai.isConfigured() ? 'configured' : 'NOT configured'
    }, vimeo ${vimeo.isConfigured() ? 'configured' : 'NOT configured'}`,
  );
  // Prove the media toolchain is REALLY present in this deploy rather than
  // assuming it. Without ffmpeg no large file can be chunked, and finding that
  // out on a customer's two-hour lecture is far worse than finding it at boot.
  ffmpegHealth()
    .then((h) => {
      if (h.ok) log.log?.(`[media-worker] media toolchain OK — ${h.ffmpeg.version}`);
      else log.warn?.(`[media-worker] MEDIA TOOLCHAIN UNAVAILABLE — ffmpeg: ${h.ffmpeg.error || 'ok'}, ffprobe: ${h.ffprobe.error || 'ok'}. Large-media transcription will fail with a clear reason.`);
    })
    .catch((e) => log.warn?.(`[media-worker] toolchain probe failed: ${e?.message || e}`));
}
