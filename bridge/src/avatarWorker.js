// Profile-photo backfill worker — deliberately the SLOWEST loop in the bridge.
//
// WHY (production audit 2026-07-30): profile pictures were fetched exactly
// once, inline, at chat-creation time — 811 creates in a 3-minute history
// burst against a rate-limited WhatsApp endpoint yielded 29 pictures (3.6%).
// And what was stored is a HOTLINKED pps.whatsapp.net CDN URL with an expiry
// token, so even those rot. This worker fixes both: it fetches gradually and
// stores OUR OWN copy in R2, served through the ordinary presign route.
//
// Policy (product decision): very conservative — ONE chat per tick, one tick
// per minute. Never blocks message processing: its own timer, one item, every
// failure swallowed. The rate is a health choice, not a throughput problem;
// do not raise it to finish faster.
//
// Scheduling contract (profilePictureNextCheckAt is the ONE gate):
//   never probed        → eligible immediately (nextCheckAt null)
//   'stored' / 'none'   → re-check after REFRESH_DAYS. A confirmed
//                          no-picture/privacy answer is a real answer — it is
//                          persisted and NOT retried aggressively.
//   'error' (transient) → bounded exponential backoff:
//                          min(30d, 1h · 4^attempts); attempts reset on any
//                          definitive outcome.
//   not connected       → nothing is stamped; the tick simply passes.
// Priority: never-probed chats first, most recently active first — the
// visible inbox enriches before dead history.
//
// Cache/duplicate contract:
//   * R2 key is STABLE per chat (whatsapp/<accountId>/avatars/<chatId>.jpg) —
//     a refresh overwrites in place: one object per chat, ever. The UI reads
//     the presign route; nothing re-fetches per render.
//
// Visibility: every outcome logs at debug; a summary line (stored / none /
// error / never-probed backlog) logs every SUMMARY_EVERY ticks and once at
// start.

import pino from 'pino';
import { config } from './config.js';
import { prisma } from './db.js';
import { isMediaConfigured, storeMedia } from './media.js';

const log = pino({ level: config.logLevel, base: { name: 'avatar-worker' } });

const TICK_MS = 60_000;
const REFRESH_DAYS = 30;
const REFRESH_MS = REFRESH_DAYS * 86_400_000;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const SUMMARY_EVERY = 30; // ticks (~half hour)

// Transient backoff: 1h, 4h, 16h, ~2.7d, ~10.7d, then the 30d cap.
function errorBackoffMs(attempts) {
  return Math.min(REFRESH_MS, 3600_000 * 4 ** Math.max(0, attempts));
}

// Probe WhatsApp for the picture URL and CLASSIFY the outcome — unlike the
// ingest-path helper (which flattens everything to null), the worker must
// distinguish "this contact has no picture" (a real, persistable answer) from
// "WhatsApp/network hiccup" (retry with backoff).
//   → { kind: 'url', url } | { kind: 'none' } | { kind: 'transient', detail }
async function probeProfilePicture(socket, jid) {
  let timer = null;
  try {
    const result = await Promise.race([
      socket.profilePictureUrl(jid, 'image'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe_timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    if (typeof result === 'string' && result) return { kind: 'url', url: result };
    return { kind: 'none' };
  } catch (err) {
    const status = err?.output?.statusCode ?? err?.data ?? null;
    const msg = String(err?.message || err);
    // Baileys signals "no picture" as item-not-found (404); privacy-restricted
    // contacts answer 401/403. All are definitive no-picture outcomes.
    if ([401, 403, 404].includes(Number(status)) || /not-found|item-not-found|forbidden|unauthorized/i.test(msg)) {
      return { kind: 'none' };
    }
    return { kind: 'transient', detail: msg };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function startAvatarWorker(client) {
  if (!isMediaConfigured()) {
    log.warn('R2 not configured — avatar worker not started (pictures stay CDN-hotlinked)');
    return null;
  }
  let ticks = 0;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await tick(client);
      ticks++;
      if (ticks % SUMMARY_EVERY === 0) await logSummary();
    } catch (err) {
      log.warn({ err: err?.message }, 'avatar tick failed (non-fatal)');
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info({ tickMs: TICK_MS, refreshDays: REFRESH_DAYS }, 'avatar worker started (1 chat/tick)');
  void logSummary();
  return timer;
}

async function logSummary() {
  try {
    const rows = await prisma.whatsAppChat.groupBy({
      by: ['profilePictureStatus'],
      where: { accountId: config.accountId },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(rows.map((r) => [r.profilePictureStatus ?? 'never_probed', r._count._all]));
    const due = await prisma.whatsAppChat.count({
      where: {
        accountId: config.accountId,
        OR: [{ profilePictureNextCheckAt: null }, { profilePictureNextCheckAt: { lte: new Date() } }],
      },
    });
    log.info({ ...byStatus, due }, 'avatar backlog summary');
  } catch (err) {
    log.debug({ err: err?.message }, 'avatar summary failed');
  }
}

async function tick(client) {
  if (!client.getReadiness().ok) return; // not connected — stamp nothing, just wait
  const socket = client.socket;
  if (!socket) return;

  const now = new Date();
  const chat = await prisma.whatsAppChat.findFirst({
    where: {
      accountId: config.accountId,
      OR: [{ profilePictureNextCheckAt: null }, { profilePictureNextCheckAt: { lte: now } }],
    },
    // Never-probed first (null checkedAt sorts first), and among those the
    // most recently ACTIVE chat — the visible inbox enriches before history.
    orderBy: [
      { profilePictureCheckedAt: { sort: 'asc', nulls: 'first' } },
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    ],
    select: {
      id: true, externalChatId: true, phoneJid: true, profilePictureAttempts: true,
    },
  });
  if (!chat) return; // backlog converged — everything scheduled in the future

  // @lid chats often refuse picture lookups; the phone-form JID works.
  const jid = chat.phoneJid || chat.externalChatId;
  const probe = await probeProfilePicture(socket, jid);

  if (probe.kind === 'none') {
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: {
        profilePictureStatus: 'none',
        profilePictureAttempts: 0,
        profilePictureCheckedAt: now,
        profilePictureNextCheckAt: new Date(now.getTime() + REFRESH_MS),
      },
    });
    log.debug({ chatId: chat.id }, 'avatar: confirmed no picture');
    return;
  }

  if (probe.kind === 'transient') {
    const attempts = (chat.profilePictureAttempts ?? 0) + 1;
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: {
        profilePictureStatus: 'error',
        profilePictureAttempts: attempts,
        profilePictureCheckedAt: now,
        profilePictureNextCheckAt: new Date(now.getTime() + errorBackoffMs(attempts)),
      },
    });
    log.debug({ chatId: chat.id, attempts, detail: probe.detail }, 'avatar: transient probe failure — backed off');
    return;
  }

  // We have a URL — download and store our own copy.
  try {
    const res = await fetch(probe.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`avatar_download_http_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_AVATAR_BYTES) {
      throw new Error(`avatar_size_${buf.byteLength}`);
    }
    const key = `whatsapp/${config.accountId}/avatars/${chat.id}.jpg`;
    await storeMedia({ key, mimeType: res.headers.get('content-type') || 'image/jpeg', data: buf });
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: {
        profilePictureKey: key,
        profilePictureUrl: probe.url, // freshest CDN URL kept as a fallback
        profilePictureStatus: 'stored',
        profilePictureAttempts: 0,
        profilePictureCheckedAt: now,
        profilePictureNextCheckAt: new Date(now.getTime() + REFRESH_MS),
      },
    });
    log.info({ chatId: chat.id, bytes: buf.byteLength }, 'avatar stored');
  } catch (err) {
    const attempts = (chat.profilePictureAttempts ?? 0) + 1;
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: {
        profilePictureStatus: 'error',
        profilePictureAttempts: attempts,
        profilePictureCheckedAt: now,
        profilePictureNextCheckAt: new Date(now.getTime() + errorBackoffMs(attempts)),
      },
    });
    log.debug({ chatId: chat.id, attempts, err: err?.message }, 'avatar: download failed — backed off');
  }
}
