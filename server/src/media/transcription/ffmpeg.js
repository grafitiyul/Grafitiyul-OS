import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// Audio extraction and chunking for the large-media transcription pipeline.
//
// ── Why ffmpeg-static rather than a Nixpacks system package ─────────────────
// This repo deploys THREE Railway services from one root (gos-server + two
// WhatsApp bridges). A root nixpacks.toml would change the build image for all
// three. `ffmpeg-static`/`ffprobe-static` are ordinary server dependencies, so
// the binary ships inside the deployed artifact for the one service that needs
// it, reproducibly, with no shared-image risk. Verified at worker start.
//
// ── Why this is memory- and disk-bounded ────────────────────────────────────
// The source is NEVER downloaded whole. ffmpeg reads the R2 object directly
// from a presigned URL and, in ONE pass, throws away the video track and writes
// small mono 16 kHz speech-grade audio segments. A 4 GB lecture therefore costs
// a few hundred MB of temporary audio, not 4 GB — and nothing is ever held in
// process memory.
//
// The provider's 25 MB per-REQUEST limit still exists; it is simply no longer a
// product limit, because the pipeline sizes every chunk far below it.

export const FFMPEG = ffmpegPath;
export const FFPROBE = ffprobeStatic.path;

// Speech-optimised: mono, 16 kHz, 32 kbps MP3 ≈ 240 KB per minute. A 10-minute
// chunk is ~2.4 MB — an order of magnitude under the provider limit, which
// leaves room for a dense-audio outlier without ever approaching it. Shorter
// chunks would multiply request count and cost for no accuracy gain; longer
// ones would coarsen progress reporting and make a single retry expensive.
export const CHUNK_SECONDS = Number(process.env.TRANSCRIBE_CHUNK_SECONDS || 600);
export const AUDIO_BITRATE = process.env.TRANSCRIBE_AUDIO_BITRATE || '32k';
export const AUDIO_RATE = 16000;

/** Is the toolchain actually present and runnable? Checked at worker start. */
export async function ffmpegHealth() {
  const probe = (bin) =>
    new Promise((resolve) => {
      try {
        const p = spawn(bin, ['-version']);
        let out = '';
        p.stdout.on('data', (d) => { out += d; });
        p.on('error', (e) => resolve({ ok: false, error: e.message }));
        p.on('close', (code) =>
          resolve(code === 0 ? { ok: true, version: out.split('\n')[0] } : { ok: false, error: `exit ${code}` }),
        );
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  const [ff, fp] = await Promise.all([probe(FFMPEG), probe(FFPROBE)]);
  return { ok: ff.ok && fp.ok, ffmpeg: ff, ffprobe: fp };
}

function run(bin, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let stderr = '';
    let stdout = '';
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new Error(`ffmpeg_timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    p.stdout.on('data', (d) => { stdout += d; });
    // ffmpeg logs progress to stderr; keep only the tail so a failure reason is
    // reportable without retaining megabytes of log.
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffmpeg_exit_${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Duration in seconds (and whether an audio stream exists at all). */
export async function probeMedia(input) {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input],
    { timeoutMs: 120_000 },
  );
  const meta = JSON.parse(stdout || '{}');
  const streams = meta.streams || [];
  const audio = streams.find((s) => s.codec_type === 'audio') || null;
  const duration = Number(meta.format?.duration ?? audio?.duration ?? 0);
  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    hasAudio: !!audio,
    audioCodec: audio?.codec_name || null,
    sizeBytes: Number(meta.format?.size ?? 0) || null,
  };
}

/** A private working directory for ONE job. Caller must always releaseWorkdir. */
export async function createWorkdir(jobId) {
  const dir = path.join(os.tmpdir(), `gos-transcribe-${jobId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function releaseWorkdir(dir) {
  if (!dir) return;
  // Best-effort: a failed cleanup must never mask the job's real outcome, but
  // it must also never be silent — the caller logs it.
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Extract speech audio from ANY source (local path or URL) and split it into
 * ordered chunks in ONE ffmpeg pass.
 *
 * `-vn` drops the video track before anything is written, which is what keeps a
 * multi-GB source from ever becoming multi-GB of temporary files.
 *
 * Returns [{ index, file, startSeconds, endSeconds }] ordered by index.
 * Boundaries are computed from the SEGMENT INDEX and the fixed segment length,
 * so they describe absolute positions in the original media — the assembler
 * relies on that to shift provider timestamps back onto the real timeline.
 */
export async function extractAudioChunks(input, workdir, { chunkSeconds = CHUNK_SECONDS, timeoutMs = 0 } = {}) {
  const pattern = path.join(workdir, 'chunk-%05d.mp3');
  await run(
    FFMPEG,
    [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      // Keep reading a network source across transient hiccups rather than
      // failing a two-hour transcode on one dropped packet.
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '30',
      '-i', input,
      '-vn',                      // drop video FIRST — the whole point
      '-ac', '1',                 // mono: speech, not stereo music
      '-ar', String(AUDIO_RATE),  // 16 kHz is what speech models expect
      '-b:a', AUDIO_BITRATE,
      '-f', 'segment',
      '-segment_time', String(chunkSeconds),
      // Segments start on a fresh frame so each file decodes standalone —
      // this is why we never cut arbitrary byte ranges out of an MP4.
      '-reset_timestamps', '1',
      pattern,
    ],
    { timeoutMs },
  );

  const files = (await fs.readdir(workdir))
    .filter((f) => /^chunk-\d+\.mp3$/.test(f))
    .sort(); // zero-padded, so lexical order IS chronological order
  return files.map((f, i) => ({
    index: i,
    file: path.join(workdir, f),
    startSeconds: i * chunkSeconds,
    endSeconds: (i + 1) * chunkSeconds,
  }));
}

/** Size of a produced chunk, for the pre-flight provider-limit assertion. */
export function chunkSize(file) {
  try {
    return fsSync.statSync(file).size;
  } catch {
    return 0;
  }
}
