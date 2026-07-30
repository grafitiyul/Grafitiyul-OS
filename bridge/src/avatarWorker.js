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
// per minute (~811 chats ≈ 13.5h for a full first pass; that is fine). Never
// blocks message processing: its own timer, one item, every failure swallowed.
//
// Cache/duplicate contract:
//   * R2 key is STABLE per chat (whatsapp/<accountId>/avatars/<chatId>.jpg) —
//     a refresh overwrites in place, so there is exactly one object per chat,
//     ever. (The key embeds the immutable chat row id, NOT the JID.)
//   * profilePictureCheckedAt stamps every attempt — including "this contact
//     has no picture / privacy-restricted" — so the worker never hammers the
//     same chat; each chat is re-checked at most once per REFRESH_DAYS.
//   * Connection-down ticks stamp nothing and simply wait for the next tick.
// Selection order: never-checked chats first, most recently active first —
// the visible inbox enriches before dead history.

import pino from 'pino';
import { config } from './config.js';
import { prisma } from './db.js';
import { fetchProfilePictureSafe } from './ingest.js';
import { isMediaConfigured, storeMedia } from './media.js';

const log = pino({ level: config.logLevel, base: { name: 'avatar-worker' } });

const TICK_MS = 60_000;
const REFRESH_DAYS = 30;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // avatars are ~10-100KB; 2MB is generous

export function startAvatarWorker(client) {
  if (!isMediaConfigured()) {
    log.warn('R2 not configured — avatar worker not started (pictures stay CDN-hotlinked)');
    return null;
  }
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await tick(client);
    } catch (err) {
      log.warn({ err: err?.message }, 'avatar tick failed (non-fatal)');
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info({ tickMs: TICK_MS, refreshDays: REFRESH_DAYS }, 'avatar worker started (1 chat/tick)');
  return timer;
}

async function tick(client) {
  if (!client.getReadiness().ok) return; // not connected — stamp nothing, just wait
  const socket = client.socket;
  if (!socket) return;

  const staleCutoff = new Date(Date.now() - REFRESH_DAYS * 86_400_000);
  const chat = await prisma.whatsAppChat.findFirst({
    where: {
      accountId: config.accountId,
      OR: [{ profilePictureCheckedAt: null }, { profilePictureCheckedAt: { lt: staleCutoff } }],
    },
    orderBy: [
      { profilePictureCheckedAt: { sort: 'asc', nulls: 'first' } },
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    ],
    select: { id: true, externalChatId: true, phoneJid: true, profilePictureKey: true },
  });
  if (!chat) return; // everything checked within the window — idle

  // @lid chats often refuse picture lookups; the phone-form JID works.
  const jid = chat.phoneJid || chat.externalChatId;
  const url = await fetchProfilePictureSafe(socket, jid, log);

  if (!url) {
    // No picture / privacy-restricted / timeout — stamp so we move on and
    // re-check this chat only after the refresh window.
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: { profilePictureCheckedAt: new Date() },
    });
    return;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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
        profilePictureUrl: url, // freshest CDN URL kept as a fallback
        profilePictureCheckedAt: new Date(),
      },
    });
    log.info({ chatId: chat.id, bytes: buf.byteLength }, 'avatar stored');
  } catch (err) {
    // Download/store failed — stamp anyway (retry lands on the next refresh
    // pass; a persistent CDN failure must not wedge the queue on one chat).
    log.debug({ chatId: chat.id, err: err?.message }, 'avatar fetch failed; stamped for later retry');
    await prisma.whatsAppChat.update({
      where: { id: chat.id },
      data: { profilePictureCheckedAt: new Date() },
    });
  }
}
