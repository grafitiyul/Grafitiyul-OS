// Voice-note transcoding: browsers record opus in WebM (Chrome/Edge) or mp4
// (Safari), but WhatsApp voice notes (PTT bubbles with waveform/speed
// controls, playable on iPhone) must be OGG/Opus. ffmpeg-static ships the
// binary; transcode via temp files. On ANY failure we fall back to sending
// the original bytes — an audio file message instead of a PTT bubble, never
// a lost message.
//
// ALWAYS re-encode — even when the browser claims it already produced
// ogg/opus. Browser MediaRecorder containers are frequently malformed
// (missing duration metadata, broken headers on some Chromium ogg builds);
// a passthrough of a bad source file silently reaches WhatsApp AND our R2
// copy. ffmpeg normalization guarantees one clean canonical file.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const OGG_OPUS = 'audio/ogg; codecs=opus';

export async function transcodeToVoiceNote(buffer, inputMime, log) {
  if (!ffmpegPath) {
    log.warn('ffmpeg-static missing — sending original audio bytes');
    return { buffer, mimetype: inputMime || 'application/octet-stream', transcoded: false };
  }
  let dir = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'gos-voice-'));
    const inFile = path.join(dir, 'in');
    const outFile = path.join(dir, 'out.ogg');
    await writeFile(inFile, buffer);
    await new Promise((resolve, reject) => {
      const args = ['-y', '-i', inFile, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', outFile];
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d;
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('ffmpeg_timeout'));
      }, 30_000);
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
    const out = await readFile(outFile);
    log.info({ inBytes: buffer.byteLength, outBytes: out.byteLength, inputMime }, 'voice transcoded to ogg/opus');
    return { buffer: out, mimetype: OGG_OPUS, transcoded: true };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message.slice(0, 300) : String(err), inputMime },
      'voice transcode failed — sending original bytes (audio file, not PTT)',
    );
    return { buffer, mimetype: inputMime || 'application/octet-stream', transcoded: false };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
