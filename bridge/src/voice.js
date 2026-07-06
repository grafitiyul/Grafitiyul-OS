// Voice-note transcoding: browsers record opus in WebM (Chrome/Edge) or mp4
// (Safari), but WhatsApp voice notes (PTT bubbles with waveform/speed
// controls, playable on iPhone) must be OGG/Opus.
//
// ALWAYS re-encode — even when the browser claims it already produced
// ogg/opus (browser containers are frequently malformed). And on ANY failure
// we now THROW instead of falling back to the original bytes: sending a
// browser WebM as ptt produced an unplayable bubble on the recipient's phone
// — a broken message the sender can't see. An honest error beats that.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const OGG_OPUS = 'audio/ogg; codecs=opus';

export function ffmpegAvailable() {
  return !!ffmpegPath && existsSync(ffmpegPath);
}

export class VoiceTranscodeError extends Error {
  constructor(message) {
    super(message);
    this.code = 'voice_transcode_failed';
  }
}

function runFfmpeg(args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg_timeout'));
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_exit_${code}: ${stderr.split('\n').slice(-3).join(' ').slice(0, 300)}`));
    });
  });
}

// WhatsApp's voice-note waveform: 64 bytes, each 0..100 — the average
// absolute amplitude per bucket, normalized so the loudest bucket is 100
// (the same shape WhatsApp's own client computes). Silence → all zeros.
const WAVEFORM_SAMPLES = 64;

function computeWaveform(pcm /* s16le mono */) {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount < WAVEFORM_SAMPLES) return new Uint8Array(WAVEFORM_SAMPLES);
  const blockSize = Math.floor(sampleCount / WAVEFORM_SAMPLES);
  const averages = new Array(WAVEFORM_SAMPLES);
  let max = 0;
  for (let i = 0; i < WAVEFORM_SAMPLES; i += 1) {
    let sum = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j += 1) {
      sum += Math.abs(pcm.readInt16LE((start + j) * 2));
    }
    const avg = sum / blockSize;
    averages[i] = avg;
    if (avg > max) max = avg;
  }
  const waveform = new Uint8Array(WAVEFORM_SAMPLES);
  if (max <= 0) return waveform;
  for (let i = 0; i < WAVEFORM_SAMPLES; i += 1) {
    waveform[i] = Math.floor((averages[i] / max) * 100);
  }
  return waveform;
}

export async function transcodeToVoiceNote(buffer, inputMime, log) {
  if (!ffmpegAvailable()) {
    log.error({ ffmpegPath }, 'ffmpeg binary unavailable — voice notes cannot be sent');
    throw new VoiceTranscodeError('ffmpeg_unavailable');
  }
  let dir = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'gos-voice-'));
    const inFile = path.join(dir, 'in');
    const outFile = path.join(dir, 'out.ogg');
    await writeFile(inFile, buffer);
    // -application voip: opus tuned for speech — the encoding WhatsApp's
    // own voice notes use.
    await runFfmpeg(['-y', '-i', inFile, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip', outFile]);
    const out = await readFile(outFile);
    // Container sanity: a valid Ogg stream starts with the OggS capture
    // pattern. Anything else must not reach WhatsApp.
    if (out.byteLength < 100 || out.subarray(0, 4).toString('latin1') !== 'OggS') {
      throw new Error(`invalid_ogg_output (${out.byteLength} bytes)`);
    }

    // Duration + waveform from the FINAL ogg's decoded PCM — WhatsApp
    // renders the native voice-note UI (waveform bar) from
    // AudioMessage.waveform; without it recipients get the compact plain
    // player. Computing it ourselves (instead of Baileys' optional
    // audio-decode path) keeps it deterministic. A failure here degrades
    // to sending without waveform — never blocks the send.
    let seconds = null;
    let waveform = null;
    try {
      const pcmFile = path.join(dir, 'out.pcm');
      await runFfmpeg(['-y', '-i', outFile, '-f', 's16le', '-ac', '1', '-ar', '16000', pcmFile]);
      const pcm = await readFile(pcmFile);
      seconds = Math.max(1, Math.round(pcm.byteLength / 2 / 16000));
      waveform = computeWaveform(pcm);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message.slice(0, 200) : String(err) }, 'waveform/duration computation failed — sending voice note without waveform');
    }

    log.info(
      { inBytes: buffer.byteLength, outBytes: out.byteLength, inputMime, seconds, hasWaveform: !!waveform },
      'voice transcoded to ogg/opus',
    );
    return { buffer: out, mimetype: OGG_OPUS, transcoded: true, seconds, waveform };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 300) : String(err);
    log.error({ err: detail, inputMime }, 'voice transcode FAILED — refusing to send unplayable audio');
    throw new VoiceTranscodeError(detail);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
