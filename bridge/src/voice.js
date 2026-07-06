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
    await new Promise((resolve, reject) => {
      // -application voip: opus tuned for speech — the encoding WhatsApp's
      // own voice notes use.
      const args = ['-y', '-i', inFile, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip', outFile];
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
    // Container sanity: a valid Ogg stream starts with the OggS capture
    // pattern. Anything else must not reach WhatsApp.
    if (out.byteLength < 100 || out.subarray(0, 4).toString('latin1') !== 'OggS') {
      throw new Error(`invalid_ogg_output (${out.byteLength} bytes)`);
    }
    log.info({ inBytes: buffer.byteLength, outBytes: out.byteLength, inputMime }, 'voice transcoded to ogg/opus');
    return { buffer: out, mimetype: OGG_OPUS, transcoded: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 300) : String(err);
    log.error({ err: detail, inputMime }, 'voice transcode FAILED — refusing to send unplayable audio');
    throw new VoiceTranscodeError(detail);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
