// POST /send handler (Slice 6) — text-only V1, called ONLY by the GOS server.
//
// Contract (ported from the proven Challenge System bridge):
//   body: { jid, text, quoted?, idempotencyKey? }
//     jid    — destination chat JID (@s.whatsapp.net / @g.us / @lid)
//     quoted — reply context reconstructed from a mirrored row:
//              { externalId, fromMe, participant, text }
//   200 { ok, externalMessageId, cached }        message accepted by WhatsApp
//   400 invalid_payload                           bad jid/text (terminal)
//   404 whatsapp_number_not_found                 not on WhatsApp (terminal)
//   503 whatsapp_not_connected (+readiness)       retry after reconnect
//   504 send_timeout | on_whatsapp_timeout        socket recycled; retry
//   500 send_failed                               Baileys threw (terminal)
//
// Idempotency: the caller-supplied key replays a recorded outcome instead of
// re-sending. Only TERMINAL outcomes are cached — connection-level failures
// stay uncached so a retry can succeed.
//
// Persistence: the outbound row is written HERE, right after WhatsApp's ack
// (with the proto payload for retransmit replay); the messages.upsert echo is
// the backup path and dedups on (accountId, externalMessageId).

import { jidToPhone, isGroupJid } from './extract.js';
import { accountState } from './accountState.js';
import { transcodeToVoiceNote } from './voice.js';
import { isMediaConfigured, buildMediaKey, storeMedia } from './media.js';

const MAX_TEXT_LEN = 4096;
const MAX_VOICE_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MEDIA_KINDS = new Set(['image', 'video', 'document']);

function extensionFor(fileName, mimeType) {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(fileName || '')?.[1];
  if (fromName) return fromName.toLowerCase();
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'application/pdf': 'pdf',
  };
  return map[mimeType] || 'bin';
}

function errSummary(err) {
  if (err instanceof Error) return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  return String(err).slice(0, 240);
}

const VALID_JID = /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/;

export function createSendHandlers({ prisma, client, accountId, log }) {
  async function cacheOutcome(key, data) {
    if (!key) return;
    try {
      await prisma.whatsAppOutboundIdempotency.upsert({
        where: { key },
        create: { key, accountId, ...data },
        update: data,
      });
    } catch (err) {
      log.warn({ err: errSummary(err), key }, '[/send] idempotency persist failed — proceeding');
    }
  }

  async function persistOutboundRow({
    jid, text = null, quotedExternalId = null, externalMessageId, payloadBytes, timestamp,
    messageType = 'text', media = null, source = 'bridge_send',
  }) {
    const isGroup = isGroupJid(jid);
    let chat = await prisma.whatsAppChat.findUnique({
      where: { accountId_externalChatId: { accountId, externalChatId: jid } },
      select: { id: true },
    });
    if (!chat) {
      chat = await prisma.whatsAppChat.create({
        data: {
          accountId,
          externalChatId: jid,
          type: isGroup ? 'group' : 'private',
          phoneNumber: jidToPhone(jid),
        },
        select: { id: true },
      });
    }
    await prisma.whatsAppMessage.upsert({
      where: { accountId_externalMessageId: { accountId, externalMessageId } },
      create: {
        accountId,
        chatId: chat.id,
        externalMessageId,
        direction: 'outgoing',
        messageType,
        textContent: text,
        quotedExternalId,
        ...(media
          ? {
              mediaStatus: media.status,
              mediaKey: media.key ?? null,
              mediaMimeType: media.mimeType ?? null,
              mediaSizeBytes: media.sizeBytes ?? null,
              mediaOriginalName: media.originalName ?? null,
            }
          : {}),
        rawPayload: { source },
        outboundPayload: payloadBytes,
        timestampFromSource: timestamp,
      },
      update: {
        ...(payloadBytes ? { outboundPayload: payloadBytes } : {}),
        ...(media?.status === 'stored'
          ? { mediaStatus: media.status, mediaKey: media.key, mediaMimeType: media.mimeType, mediaSizeBytes: media.sizeBytes }
          : {}),
      },
    });
    await prisma.whatsAppChat.update({ where: { id: chat.id }, data: { lastMessageAt: timestamp } });
    await accountState.heartbeat(prisma);
    return chat.id;
  }

  async function handleSend(req, res) {
    const b = req.body || {};
    const jid = typeof b.jid === 'string' ? b.jid.trim() : '';
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    const idempotencyKey = typeof b.idempotencyKey === 'string' && b.idempotencyKey ? b.idempotencyKey : null;
    const quoted = b.quoted && typeof b.quoted === 'object' ? b.quoted : null;

    if (!VALID_JID.test(jid) || !text || text.length > MAX_TEXT_LEN) {
      log.warn({ jidShape: jid.slice(-24), textLen: text.length }, '[/send] invalid_payload');
      return res.status(400).json({ error: 'invalid_payload' });
    }

    // Replay a recorded outcome for this key.
    if (idempotencyKey) {
      try {
        const cached = await prisma.whatsAppOutboundIdempotency.findUnique({ where: { key: idempotencyKey } });
        if (cached) {
          log.info({ idempotencyKey, outcome: cached.outcome }, '[/send] idempotency hit — replaying');
          if (cached.outcome === 'ok') {
            return res.json({ ok: true, externalMessageId: cached.externalMessageId, cached: true });
          }
          const code = cached.errorCode || 'send_failed';
          const status = code === 'whatsapp_number_not_found' ? 404 : code === 'invalid_payload' ? 400 : 500;
          return res.status(status).json({ error: code, detail: cached.errorMessage ?? undefined, cached: true });
        }
      } catch (err) {
        log.warn({ err: errSummary(err), idempotencyKey }, '[/send] idempotency lookup failed — treating as miss');
      }
    }

    let result;
    try {
      result = await client.sendText({ jid, text, quoted });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'send_failed';
      if (code === 'whatsapp_not_connected') {
        return res.status(503).json({ error: 'whatsapp_not_connected', readiness: client.getReadiness() });
      }
      if (code === 'send_timeout' || code === 'on_whatsapp_timeout' || code === 'on_whatsapp_failed') {
        return res.status(504).json({ error: code });
      }
      if (code === 'whatsapp_number_not_found') {
        await cacheOutcome(idempotencyKey, { outcome: 'failed', errorCode: code });
        return res.status(404).json({ error: code });
      }
      const detail = errSummary(err);
      log.error({ err: detail }, '[/send] send_failed');
      await cacheOutcome(idempotencyKey, { outcome: 'failed', errorCode: 'send_failed', errorMessage: detail });
      return res.status(500).json({ error: 'send_failed', detail });
    }

    let chatId = null;
    try {
      chatId = await persistOutboundRow({
        jid,
        text,
        quotedExternalId: quoted?.externalId ?? null,
        externalMessageId: result.externalMessageId,
        payloadBytes: result.payloadBytes,
        timestamp: result.timestamp,
      });
    } catch (err) {
      // Non-fatal: the message IS out; the echo will create the row.
      log.warn({ err: errSummary(err), externalMessageId: result.externalMessageId }, '[/send] outbound row persist failed; relying on echo');
    }

    await cacheOutcome(idempotencyKey, { outcome: 'ok', externalMessageId: result.externalMessageId, errorCode: null, errorMessage: null });
    return res.json({ ok: true, externalMessageId: result.externalMessageId, chatId, cached: false });
  }

  // POST /send-voice — { jid, audioBase64, mimeType, seconds?, idempotencyKey? }
  // Browser recording → OGG/Opus transcode (real PTT voice note) → serialized
  // send → outbound row persisted WITH the audio stored in R2 (same
  // whatsapp/<accountId>/ key contract, mediaStatus honest when R2 is off).
  async function handleSendVoice(req, res) {
    const b = req.body || {};
    const jid = typeof b.jid === 'string' ? b.jid.trim() : '';
    const audioBase64 = typeof b.audioBase64 === 'string' ? b.audioBase64 : '';
    const mimeType = typeof b.mimeType === 'string' ? b.mimeType : '';
    const seconds = Number(b.seconds) || null;
    const idempotencyKey = typeof b.idempotencyKey === 'string' && b.idempotencyKey ? b.idempotencyKey : null;

    let raw = null;
    try {
      raw = Buffer.from(audioBase64, 'base64');
    } catch {
      raw = null;
    }
    if (!VALID_JID.test(jid) || !raw || raw.byteLength < 100 || raw.byteLength > MAX_VOICE_BYTES) {
      log.warn({ jidShape: jid.slice(-24), bytes: raw?.byteLength ?? 0 }, '[/send-voice] invalid_payload');
      return res.status(400).json({ error: 'invalid_payload' });
    }

    if (idempotencyKey) {
      try {
        const cached = await prisma.whatsAppOutboundIdempotency.findUnique({ where: { key: idempotencyKey } });
        if (cached) {
          log.info({ idempotencyKey, outcome: cached.outcome }, '[/send-voice] idempotency hit — replaying');
          if (cached.outcome === 'ok') {
            return res.json({ ok: true, externalMessageId: cached.externalMessageId, cached: true });
          }
          const code = cached.errorCode || 'send_failed';
          const status = code === 'whatsapp_number_not_found' ? 404 : code === 'invalid_payload' ? 400 : 500;
          return res.status(status).json({ error: code, cached: true });
        }
      } catch (err) {
        log.warn({ err: errSummary(err), idempotencyKey }, '[/send-voice] idempotency lookup failed — treating as miss');
      }
    }

    const voice = await transcodeToVoiceNote(raw, mimeType, log);

    let result;
    try {
      result = await client.sendVoice({ jid, buffer: voice.buffer, mimetype: voice.mimetype, seconds });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'send_failed';
      if (code === 'whatsapp_not_connected') {
        return res.status(503).json({ error: 'whatsapp_not_connected', readiness: client.getReadiness() });
      }
      if (code === 'send_timeout' || code === 'on_whatsapp_timeout' || code === 'on_whatsapp_failed') {
        return res.status(504).json({ error: code });
      }
      if (code === 'whatsapp_number_not_found') {
        await cacheOutcome(idempotencyKey, { outcome: 'failed', errorCode: code });
        return res.status(404).json({ error: code });
      }
      const detail = errSummary(err);
      log.error({ err: detail }, '[/send-voice] send_failed');
      await cacheOutcome(idempotencyKey, { outcome: 'failed', errorCode: 'send_failed', errorMessage: detail });
      return res.status(500).json({ error: 'send_failed', detail });
    }

    // Store OUR copy in R2 so the sent voice note is playable in GOS forever
    // (same store as inbound media). Honest 'disabled' when R2 is off.
    let media = { status: 'disabled', mimeType: voice.mimetype, sizeBytes: voice.buffer.byteLength };
    if (isMediaConfigured()) {
      try {
        const ext = /ogg/.test(voice.mimetype) ? 'ogg' : 'bin';
        const key = buildMediaKey(accountId, jid, result.externalMessageId, ext, result.timestamp);
        const stored = await storeMedia({ key, mimeType: voice.mimetype, data: voice.buffer });
        media = { status: 'stored', key: stored.key, mimeType: voice.mimetype, sizeBytes: stored.size };
      } catch (err) {
        log.warn({ err: errSummary(err) }, '[/send-voice] R2 store failed — message sent, media marked failed');
        media = { status: 'failed', mimeType: voice.mimetype, sizeBytes: voice.buffer.byteLength };
      }
    }

    let chatId = null;
    try {
      chatId = await persistOutboundRow({
        jid,
        externalMessageId: result.externalMessageId,
        payloadBytes: result.payloadBytes,
        timestamp: result.timestamp,
        messageType: 'audio',
        media,
        source: 'bridge_send_voice',
      });
    } catch (err) {
      log.warn({ err: errSummary(err), externalMessageId: result.externalMessageId }, '[/send-voice] outbound row persist failed; relying on echo');
    }

    await cacheOutcome(idempotencyKey, { outcome: 'ok', externalMessageId: result.externalMessageId, errorCode: null, errorMessage: null });
    return res.json({ ok: true, externalMessageId: result.externalMessageId, chatId, cached: false });
  }

  // POST /send-media — { jid, mediaBase64, mimeType, fileName, kind, caption?, idempotencyKey? }
  // kind: image | video | document. Sent as REAL WhatsApp media (never a
  // link); our copy stored in R2 under the account prefix, honest statuses.
  async function handleSendMedia(req, res) {
    const b = req.body || {};
    const jid = typeof b.jid === 'string' ? b.jid.trim() : '';
    const mediaBase64 = typeof b.mediaBase64 === 'string' ? b.mediaBase64 : '';
    const mimeType = typeof b.mimeType === 'string' && b.mimeType ? b.mimeType : 'application/octet-stream';
    const fileName = typeof b.fileName === 'string' ? b.fileName.slice(0, 180) : '';
    const kind = typeof b.kind === 'string' ? b.kind : '';
    const caption = typeof b.caption === 'string' ? b.caption.trim().slice(0, MAX_TEXT_LEN) : '';
    const idempotencyKey = typeof b.idempotencyKey === 'string' && b.idempotencyKey ? b.idempotencyKey : null;

    let raw = null;
    try {
      raw = Buffer.from(mediaBase64, 'base64');
    } catch {
      raw = null;
    }
    if (!VALID_JID.test(jid) || !MEDIA_KINDS.has(kind) || !raw || raw.byteLength < 10) {
      log.warn({ jidShape: jid.slice(-24), kind, bytes: raw?.byteLength ?? 0 }, '[/send-media] invalid_payload');
      return res.status(400).json({ error: 'invalid_payload' });
    }
    if (raw.byteLength > MAX_MEDIA_BYTES) {
      return res.status(400).json({ error: 'media_too_large' });
    }

    if (idempotencyKey) {
      try {
        const cached = await prisma.whatsAppOutboundIdempotency.findUnique({ where: { key: idempotencyKey } });
        if (cached) {
          log.info({ idempotencyKey, outcome: cached.outcome }, '[/send-media] idempotency hit — replaying');
          if (cached.outcome === 'ok') {
            return res.json({ ok: true, externalMessageId: cached.externalMessageId, cached: true });
          }
          const code = cached.errorCode || 'send_failed';
          const status = code === 'whatsapp_number_not_found' ? 404 : code === 'invalid_payload' ? 400 : 500;
          return res.status(status).json({ error: code, cached: true });
        }
      } catch (err) {
        log.warn({ err: errSummary(err), idempotencyKey }, '[/send-media] idempotency lookup failed — treating as miss');
      }
    }

    const content =
      kind === 'image'
        ? { image: raw, ...(caption ? { caption } : {}) }
        : kind === 'video'
          ? { video: raw, mimetype: mimeType, ...(caption ? { caption } : {}) }
          : { document: raw, mimetype: mimeType, fileName: fileName || 'file', ...(caption ? { caption } : {}) };

    let result;
    try {
      result = await client.sendContent(jid, content);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'send_failed';
      if (code === 'whatsapp_not_connected') {
        return res.status(503).json({ error: 'whatsapp_not_connected', readiness: client.getReadiness() });
      }
      if (code === 'send_timeout' || code === 'on_whatsapp_timeout' || code === 'on_whatsapp_failed') {
        return res.status(504).json({ error: code });
      }
      if (code === 'whatsapp_number_not_found') {
        await cacheOutcome(idempotencyKey, { outcome: 'failed', errorCode: code });
        return res.status(404).json({ error: code });
      }
      const detail = errSummary(err);
      log.error({ err: detail, kind }, '[/send-media] send_failed');
      await cacheOutcome(idempotencyKey, { outcome: 'failed', errorCode: 'send_failed', errorMessage: detail });
      return res.status(500).json({ error: 'send_failed', detail });
    }

    let media = { status: 'disabled', mimeType, sizeBytes: raw.byteLength };
    if (isMediaConfigured()) {
      try {
        const key = buildMediaKey(accountId, jid, result.externalMessageId, extensionFor(fileName, mimeType), result.timestamp);
        const stored = await storeMedia({ key, mimeType, data: raw });
        media = { status: 'stored', key: stored.key, mimeType, sizeBytes: stored.size };
      } catch (err) {
        log.warn({ err: errSummary(err) }, '[/send-media] R2 store failed — message sent, media marked failed');
        media = { status: 'failed', mimeType, sizeBytes: raw.byteLength };
      }
    }

    let chatId = null;
    try {
      chatId = await persistOutboundRow({
        jid,
        text: caption || null,
        externalMessageId: result.externalMessageId,
        payloadBytes: result.payloadBytes,
        timestamp: result.timestamp,
        messageType: kind,
        media: { ...media, originalName: fileName || null },
        source: 'bridge_send_media',
      });
    } catch (err) {
      log.warn({ err: errSummary(err), externalMessageId: result.externalMessageId }, '[/send-media] outbound row persist failed; relying on echo');
    }

    await cacheOutcome(idempotencyKey, { outcome: 'ok', externalMessageId: result.externalMessageId, errorCode: null, errorMessage: null });
    return res.json({ ok: true, externalMessageId: result.externalMessageId, chatId, cached: false });
  }

  return { handleSend, handleSendVoice, handleSendMedia };
}
