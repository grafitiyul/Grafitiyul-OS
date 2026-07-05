// Message / history / reaction / identity ingestion — port of the proven
// Challenge System handlers (messages.ts + chats.ts + contacts.ts), account-
// scoped and with the GOS media-first pipeline:
//
//   1. The message row is created IMMEDIATELY (text mirror is never blocked
//      by a download); media rows start at mediaStatus='pending' and carry
//      the embedded jpegThumbnail for instant previews.
//   2. Media bytes are then downloaded (decrypted by Baileys) and uploaded
//      PRIVATE to R2 under whatsapp/<accountId>/…, serialized through a
//      per-account chain so a history burst can't stampede WhatsApp or R2.
//   3. Failures/oversizes/disabled-R2 are recorded honestly on the row
//      (failed | expired | too_large | disabled) — never silently dropped.
//
// createIngest() is a FACTORY: one instance per live socket, holding no
// module-level account state (two accounts in one process could never share
// anything). Every handler must be registered with the caller's socketId
// guard (see waClient.js) — stale-socket events are dropped there.
//
// Logging policy (strict): never log textContent, captions, or media bytes.

import { getBaileys } from './baileysLib.js';
import { accountState } from './accountState.js';
import { extractContent, isGroupJid, isLikelyRealPhone, jidToPhone, sanitiseRawPayload } from './extract.js';
import { isMediaConfigured, buildMediaKey, storeMedia } from './media.js';
import { config } from './config.js';

function errSummary(err) {
  if (err instanceof Error) return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  return String(err).slice(0, 240);
}

function pickName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// The contact's real phone JID on INBOUND messages — present even when
// remoteJid is a privacy id (@lid), where it is the ONLY phone source.
// v7: key.remoteJidAlt (DMs) / key.participantAlt (group senders);
// 6.7.x: key.senderPn. Read defensively; strict @s.whatsapp.net only.
function senderPnFromKey(key) {
  for (const candidate of [key?.participantAlt, key?.remoteJidAlt, key?.senderPn]) {
    if (typeof candidate === 'string' && candidate.endsWith('@s.whatsapp.net')) return candidate;
  }
  return null;
}

// Best-effort profile-picture fetch — always resolves (privacy-restricted
// contacts return 401/403 = "no picture"), bounded by a 5s timeout so a hung
// WhatsApp server can't block ingest.
async function fetchProfilePictureSafe(socket, jid, log) {
  const FETCH_TIMEOUT_MS = 5_000;
  let timer = null;
  try {
    const probe = socket.profilePictureUrl(jid, 'image');
    probe.catch(() => undefined);
    const result = await Promise.race([
      probe,
      new Promise((res) => {
        timer = setTimeout(() => res(null), FETCH_TIMEOUT_MS);
      }),
    ]);
    return typeof result === 'string' && result ? result : null;
  } catch (err) {
    log.debug({ jid, err: errSummary(err) }, 'profilePictureUrl fetch failed; no picture');
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createIngest({ prisma, socket, log, accountId }) {
  // Per-account serialized media pipeline. Errors never poison the chain.
  let mediaChain = Promise.resolve();
  const enqueueMedia = (fn) => {
    mediaChain = mediaChain.then(fn, fn).catch(() => undefined);
  };

  // ── chat upsert ─────────────────────────────────────────────────────────
  // Identity rules (hard-learned in production, kept verbatim):
  //   - pushName: only from NON-fromMe messages (else every chat gets named
  //     after the connected owner).
  //   - phoneNumber: the COUNTERPARTY's phone (from externalChatId or inbound
  //     senderPn) — never the owner's, never @lid digits.
  //   - savedContactName/groupSubject: written only by their event handlers.
  async function upsertChat(externalChatId, isGroup, senderPushName, counterpartyPhone, senderPnJid, lastMessageAt) {
    const existing = await prisma.whatsAppChat.findUnique({
      where: { accountId_externalChatId: { accountId, externalChatId } },
      select: { id: true, pushName: true, phoneNumber: true, phoneJid: true },
    });

    if (existing) {
      const patch = {};
      if (!isGroup && senderPushName && senderPushName !== existing.pushName) {
        patch.pushName = senderPushName;
      }
      // Self-heal phone from the authoritative inbound senderPn: write when
      // missing or PROVEN GARBAGE (owner's own number / the chat's @lid
      // digits) — never over a legitimate different phone.
      if (!isGroup && senderPnJid) {
        const senderPnPhone = jidToPhone(senderPnJid);
        const ownerDigits = jidToPhone(socket.user?.phoneNumber ?? socket.user?.id ?? null);
        const lidDigits = externalChatId.endsWith('@lid')
          ? externalChatId.split('@')[0].split(':')[0].replace(/\D/g, '') || null
          : null;
        const digitsOf = (v) => (v ?? '').replace(/\D/g, '') || null;
        const isGarbage = (v) => {
          const d = digitsOf(v);
          if (!d) return false;
          return (!!ownerDigits && d === digitsOf(ownerDigits)) || (!!lidDigits && d === lidDigits);
        };
        if (senderPnPhone && existing.phoneNumber !== senderPnPhone
          && (existing.phoneNumber == null || isGarbage(existing.phoneNumber))) {
          patch.phoneNumber = senderPnPhone;
        }
        if (existing.phoneJid !== senderPnJid
          && (existing.phoneJid == null || isGarbage(existing.phoneJid))) {
          patch.phoneJid = senderPnJid;
        }
      }
      if (Object.keys(patch).length > 0) {
        await prisma.whatsAppChat.update({ where: { id: existing.id }, data: patch });
      }
      return { id: existing.id };
    }

    // New chat.
    let groupSubject = null;
    if (isGroup) {
      try {
        const meta = await socket.groupMetadata(externalChatId);
        groupSubject = meta.subject ?? null;
      } catch (err) {
        log.warn({ chatId: externalChatId, err: errSummary(err) }, 'groupMetadata fetch failed; groupSubject left null');
      }
    }
    const profilePictureUrl = await fetchProfilePictureSafe(socket, externalChatId, log);
    const lidJid = !isGroup && externalChatId.endsWith('@lid') ? externalChatId : null;
    const phoneJidFromChatId = !isGroup && externalChatId.endsWith('@s.whatsapp.net') ? externalChatId : null;
    const senderPnPhone = senderPnJid ? jidToPhone(senderPnJid) : null;

    return prisma.whatsAppChat.create({
      data: {
        accountId,
        externalChatId,
        type: isGroup ? 'group' : 'private',
        pushName: isGroup ? null : senderPushName,
        groupSubject,
        phoneNumber: counterpartyPhone ?? senderPnPhone,
        lidJid,
        phoneJid: phoneJidFromChatId ?? senderPnJid,
        profilePictureUrl,
        lastMessageAt,
      },
      select: { id: true },
    });
  }

  // ── media pipeline ──────────────────────────────────────────────────────
  function scheduleMediaDownload(messageRowId, msg, mediaInfo, externalChatId, externalMessageId, timestampFromSource, source) {
    enqueueMedia(async () => {
      try {
        if (mediaInfo.sizeBytes && mediaInfo.sizeBytes > config.mediaMaxBytes) {
          await prisma.whatsAppMessage.update({ where: { id: messageRowId }, data: { mediaStatus: 'too_large' } });
          return;
        }
        // downloadMediaMessage handles WhatsApp's media decryption; the
        // reuploadRequest path asks WhatsApp for a fresh reference when the
        // original URL went stale.
        const buffer = await getBaileys().downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: log, reuploadRequest: socket.updateMediaMessage },
        );
        if (buffer.byteLength > config.mediaMaxBytes) {
          await prisma.whatsAppMessage.update({ where: { id: messageRowId }, data: { mediaStatus: 'too_large', mediaSizeBytes: buffer.byteLength } });
          return;
        }
        const key = buildMediaKey(accountId, externalChatId, externalMessageId, mediaInfo.extension, timestampFromSource);
        const result = await storeMedia({ key, mimeType: mediaInfo.mimeType, data: buffer });
        await prisma.whatsAppMessage.update({
          where: { id: messageRowId },
          data: { mediaStatus: 'stored', mediaKey: result.key, mediaSizeBytes: result.size },
        });
        log.info(
          { msgId: externalMessageId, chatId: externalChatId, mediaType: mediaInfo.type, sizeBytes: result.size },
          'media stored',
        );
        await accountState.clearMediaError(prisma);
      } catch (err) {
        const summary = errSummary(err);
        log.warn(
          { msgId: externalMessageId, chatId: externalChatId, mediaType: mediaInfo.type, err: summary },
          'media download/store failed',
        );
        // History-synced messages whose media fails are almost always past
        // WhatsApp's retention — report them honestly as expired; live
        // failures stay 'failed' (transient, theoretically retryable).
        const status = source === 'history' ? 'expired' : 'failed';
        await prisma.whatsAppMessage
          .update({ where: { id: messageRowId }, data: { mediaStatus: status } })
          .catch(() => undefined);
        await accountState.setMediaError(prisma, `${mediaInfo.type}: ${summary}`);
      }
    });
  }

  // ── single-message ingest ───────────────────────────────────────────────
  async function ingestMessage(msg, source) {
    if (!msg.key?.id || !msg.key?.remoteJid) return;
    const externalMessageId = msg.key.id;
    const externalChatId = msg.key.remoteJid;

    const content = extractContent(msg);
    if (content.skip) return;

    // Idempotency short-circuit — cheaper than building the payload (and a
    // media download) just to discard it on the unique index.
    const existing = await prisma.whatsAppMessage.findUnique({
      where: { accountId_externalMessageId: { accountId, externalMessageId } },
      select: { id: true },
    });
    if (existing) return;

    const isGroup = isGroupJid(externalChatId);
    const isFromMe = msg.key.fromMe === true;
    const direction = isFromMe ? 'outgoing' : 'incoming';
    // v7: for LID-migrated accounts user.id is the LID; the phone JID lives
    // in user.phoneNumber — prefer it so fromMe senderPhone stays a phone.
    const senderJid = isFromMe
      ? socket.user?.phoneNumber ?? socket.user?.id ?? null
      : (msg.key.participant ?? msg.key.remoteJid);
    const senderPhone = jidToPhone(senderJid);
    const senderName = msg.pushName ?? null;
    // fromMe pushName is the OWNER's display name — never let it reach the
    // chat row (the "every chat named after the owner" bug).
    const senderPushNameForChat = isFromMe ? null : senderName;
    const chatPhoneFromCounterparty = isGroup ? null : jidToPhone(externalChatId);
    const senderPnJid = !isGroup && !isFromMe ? senderPnFromKey(msg.key) : null;
    const timestampSec = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp ?? 0);
    const timestampFromSource = new Date(timestampSec * 1000);

    const chat = await upsertChat(
      externalChatId, isGroup, senderPushNameForChat, chatPhoneFromCounterparty, senderPnJid, timestampFromSource,
    );

    const initialMediaStatus = content.mediaInfo ? (isMediaConfigured() ? 'pending' : 'disabled') : null;

    const row = await prisma.whatsAppMessage.create({
      data: {
        accountId,
        chatId: chat.id,
        externalMessageId,
        direction,
        senderName,
        senderPhone,
        messageType: content.messageType,
        textContent: content.textContent,
        mediaStatus: initialMediaStatus,
        mediaMimeType: content.mediaInfo?.mimeType ?? null,
        mediaSizeBytes: content.mediaInfo?.sizeBytes ?? null,
        mediaOriginalName: content.mediaInfo?.fileName ?? null,
        mediaThumbBase64: content.thumbBase64,
        quotedExternalId: content.quotedExternalId,
        rawPayload: sanitiseRawPayload(msg),
        timestampFromSource,
      },
      select: { id: true },
    });

    if (content.mediaInfo && initialMediaStatus === 'pending') {
      scheduleMediaDownload(row.id, msg, content.mediaInfo, externalChatId, externalMessageId, timestampFromSource, source);
    }

    await prisma.whatsAppChat.update({ where: { id: chat.id }, data: { lastMessageAt: timestampFromSource } });
    await accountState.heartbeat(prisma);
    if (direction === 'incoming') await accountState.inboundHeartbeat(prisma);
  }

  // ── identity: chats.upsert / chats.update ───────────────────────────────
  async function applyChatIdentity(externalChatId, rawName) {
    // Owner-leak guard: the owner's chat-with-self must never name a row.
    if (socket.user?.id && externalChatId === socket.user.id) return;
    const name = pickName(rawName);
    if (!name) return;
    const isGroup = isGroupJid(externalChatId);
    // Only rows we already track — never seed empty chats from metadata.
    const existing = await prisma.whatsAppChat.findUnique({
      where: { accountId_externalChatId: { accountId, externalChatId } },
      select: { id: true, savedContactName: true, groupSubject: true, lidJid: true, phoneJid: true },
    });
    if (!existing) return;

    if (isGroup) {
      if (existing.groupSubject !== name) {
        await prisma.whatsAppChat.update({ where: { id: existing.id }, data: { groupSubject: name } });
      }
      return;
    }
    const data = {};
    if (existing.savedContactName !== name) data.savedContactName = name;
    if (externalChatId.endsWith('@lid') && !existing.lidJid) data.lidJid = externalChatId;
    if (externalChatId.endsWith('@s.whatsapp.net') && !existing.phoneJid) data.phoneJid = externalChatId;
    if (Object.keys(data).length > 0) {
      await prisma.whatsAppChat.update({ where: { id: existing.id }, data });
    }
  }

  // ── identity: contacts.upsert / contacts.update ─────────────────────────
  // A Contact event carries multiple forms of the SAME person (id / lid /
  // phoneNumber-jid). Fan the update out across every form so a saved name
  // reaches @lid-keyed chat rows too (the "איש קשר לא מזוהה" fix).
  async function applyContactIdentity(contact) {
    const ownerJid = socket.user?.id;
    const pnJid = contact.phoneNumber ?? contact.jid; // v7 name ?? 6.7.x name
    const forms = [contact.id, contact.lid, pnJid].filter(
      (j) => typeof j === 'string' && j && !isGroupJid(j) && j !== ownerJid,
    );
    const candidateJids = [...new Set(forms)];
    if (candidateJids.length === 0) return;

    const savedName = pickName(contact.name);
    const notifyName = pickName(contact.notify);
    const realPhone = pnJid ? jidToPhone(pnJid) : null;
    const hasCrossReference = !!contact.lid && !!pnJid;
    if (!savedName && !notifyName && !realPhone && !hasCrossReference) return;

    const rows = await prisma.whatsAppChat.findMany({
      where: {
        accountId,
        OR: [
          { externalChatId: { in: candidateJids } },
          { lidJid: { in: candidateJids } },
          { phoneJid: { in: candidateJids } },
        ],
      },
      select: { id: true, savedContactName: true, pushName: true, phoneNumber: true, lidJid: true, phoneJid: true },
    });

    for (const row of rows) {
      const data = {};
      if (savedName && savedName !== row.savedContactName) data.savedContactName = savedName;
      if (notifyName && notifyName !== row.pushName) data.pushName = notifyName;
      // Overwrite a stored phone only when missing or NOT real-phone-shaped
      // (stale @lid digits); a whitelisted real phone is left alone.
      if (realPhone && (!row.phoneNumber || !isLikelyRealPhone(row.phoneNumber))) data.phoneNumber = realPhone;
      if (contact.lid && !row.lidJid) data.lidJid = contact.lid;
      if (pnJid && !row.phoneJid) data.phoneJid = pnJid;
      if (Object.keys(data).length === 0) continue;
      await prisma.whatsAppChat.update({ where: { id: row.id }, data });
    }
  }

  // ── v7 PN↔LID mapping harvest (history bundle) ─────────────────────────
  async function harvestLidPnMappings(mappings) {
    try {
      await socket.signalRepository?.lidMapping?.storeLIDPNMappings?.(mappings);
    } catch (err) {
      log.warn({ err: errSummary(err), count: mappings.length }, 'lid-mapping store failed');
    }
    for (const m of mappings) {
      try {
        const lidJid = m.lid.includes('@') ? m.lid : `${m.lid}@lid`;
        const pnJid = m.pn.includes('@') ? m.pn : `${m.pn}@s.whatsapp.net`;
        if (!lidJid.endsWith('@lid') || !pnJid.endsWith('@s.whatsapp.net')) continue;
        const phone = jidToPhone(pnJid);
        // Conservative: only NULL columns are filled; never overwrite.
        await prisma.whatsAppChat.updateMany({
          where: { accountId, externalChatId: lidJid, phoneJid: null },
          data: { phoneJid: pnJid },
        });
        if (phone) {
          await prisma.whatsAppChat.updateMany({
            where: { accountId, externalChatId: lidJid, phoneNumber: null },
            data: { phoneNumber: phone },
          });
        }
      } catch (err) {
        log.warn({ err: errSummary(err), lid: m.lid }, 'chat lid→pn forward-fill failed');
      }
    }
  }

  // ── reactions ───────────────────────────────────────────────────────────
  async function ingestReaction(r) {
    const targetId = r.key?.id;
    if (!targetId) return;
    const reactorPhone = jidToPhone(r.key?.participant ?? r.key?.remoteJid ?? null);
    if (!reactorPhone) return;
    const emoji = r.text ?? '';
    const reactedAt = r.senderTimestampMs ? new Date(Number(r.senderTimestampMs)) : new Date();
    await prisma.whatsAppMessageReaction.upsert({
      where: {
        accountId_externalMessageId_reactorPhone: { accountId, externalMessageId: targetId, reactorPhone },
      },
      create: { accountId, externalMessageId: targetId, reactorPhone, emoji, reactedAt },
      update: { emoji, reactedAt },
    });
  }

  // ── public handlers (one failure never poisons a batch) ─────────────────
  return {
    async onMessagesUpsert(payload) {
      for (const msg of payload.messages || []) {
        try {
          await ingestMessage(msg, payload.type);
        } catch (err) {
          log.error(
            { err: errSummary(err), msgId: msg.key?.id ?? null, chatId: msg.key?.remoteJid ?? null, batchType: payload.type },
            'message ingest failed',
          );
        }
      }
    },

    async onHistorySync(history) {
      const messages = history.messages ?? [];
      const chats = history.chats ?? [];
      const contacts = history.contacts ?? [];
      const lidPnMappings = history.lidPnMappings ?? [];
      if (!messages.length && !chats.length && !contacts.length && !lidPnMappings.length) return;
      log.info(
        { msgCount: messages.length, chatCount: chats.length, contactCount: contacts.length, lidPnMappingCount: lidPnMappings.length, isLatest: history.isLatest },
        'history sync: ingesting',
      );
      if (lidPnMappings.length) await harvestLidPnMappings(lidPnMappings);
      // Identity FIRST so the message pass finds populated columns; both
      // identity handlers are no-ops on untracked chats.
      for (const c of contacts) {
        try {
          if (c.id) await applyContactIdentity(c);
        } catch (err) {
          log.warn({ contactId: c.id, err: errSummary(err) }, 'history contacts identity failed');
        }
      }
      for (const c of chats) {
        try {
          if (c.id) await applyChatIdentity(c.id, c.name);
        } catch (err) {
          log.warn({ chatId: c.id, err: errSummary(err) }, 'history chats identity failed');
        }
      }
      for (const msg of messages) {
        try {
          await ingestMessage(msg, 'history');
        } catch (err) {
          log.error({ err: errSummary(err), msgId: msg.key?.id ?? null, chatId: msg.key?.remoteJid ?? null }, 'history-sync ingest failed');
        }
      }
    },

    async onReactions(reactions) {
      for (const r of reactions || []) {
        try {
          await ingestReaction(r);
        } catch (err) {
          log.error({ err: errSummary(err), targetMsgId: r.key?.id ?? null }, 'reaction ingest failed');
        }
      }
    },

    async onChatsUpsert(chats) {
      for (const chat of chats || []) {
        if (!chat.id) continue;
        try {
          await applyChatIdentity(chat.id, chat.name);
        } catch (err) {
          log.warn({ chatId: chat.id, err: errSummary(err) }, 'chats.upsert identity failed');
        }
      }
    },

    async onChatsUpdate(updates) {
      for (const update of updates || []) {
        if (!update.id || update.name === undefined) continue;
        try {
          await applyChatIdentity(update.id, update.name);
        } catch (err) {
          log.warn({ chatId: update.id, err: errSummary(err) }, 'chats.update identity failed');
        }
      }
    },

    async onContactsUpsert(contacts) {
      for (const contact of contacts || []) {
        if (!contact.id) continue;
        try {
          await applyContactIdentity(contact);
        } catch (err) {
          log.warn({ contactId: contact.id, err: errSummary(err) }, 'contacts.upsert identity failed');
        }
      }
    },

    async onContactsUpdate(updates) {
      for (const update of updates || []) {
        if (!update.id) continue;
        try {
          await applyContactIdentity(update);
        } catch (err) {
          log.warn({ contactId: update.id, err: errSummary(err) }, 'contacts.update identity failed');
        }
      }
    },
  };
}
