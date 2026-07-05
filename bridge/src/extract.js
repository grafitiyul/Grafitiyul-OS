// Pure helpers for turning a Baileys WAMessage into the columns we store on
// WhatsAppMessage — port of the proven Challenge System extract.ts, plus
// embedded-thumbnail capture (jpegThumbnail) for instant media previews.
// No I/O, no Prisma — fully unit-testable.
//
// Logging policy: this module is content-aware. Callers must not log anything
// returned from here at info/warn level (textContent / fileName can contain
// message contents).

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
};

function extensionFor(mime, fileName) {
  if (mime && EXT_BY_TYPE[mime]) return EXT_BY_TYPE[mime];
  if (mime) {
    const after = mime.split(';')[0]?.split('/')[1];
    if (after) return after.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  }
  if (fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot > 0 && dot < fileName.length - 1) {
      return fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    }
  }
  return 'bin';
}

// WhatsApp embeds a tiny JPEG preview (a few KB) in image/video payloads.
// Capturing it at extract time gives the chat UI an instant blurred preview
// even while (or if) the full download is pending/failed. Capped so a
// malformed payload can never bloat the DB row.
const THUMB_MAX_BYTES = 24 * 1024;

function thumbBase64(node) {
  const t = node?.jpegThumbnail;
  if (!t || !(t instanceof Uint8Array) || t.length === 0 || t.length > THUMB_MAX_BYTES) return null;
  return Buffer.from(t).toString('base64');
}

function unwrapEnvelope(content) {
  if (content.ephemeralMessage?.message) return content.ephemeralMessage.message;
  if (content.viewOnceMessage?.message) return content.viewOnceMessage.message;
  if (content.viewOnceMessageV2?.message) return content.viewOnceMessageV2.message;
  if (content.viewOnceMessageV2Extension?.message) return content.viewOnceMessageV2Extension.message;
  return content;
}

// → { messageType, textContent, mediaInfo, thumbBase64, quotedExternalId, skip }
// mediaInfo: { type, mimeType, fileName, sizeBytes, extension } | null
// skip=true → silently drop (protocol chatter); 'system' rows ARE stored.
export function extractContent(msg) {
  const m = msg.message;
  const none = { messageType: 'system', textContent: null, mediaInfo: null, thumbBase64: null, quotedExternalId: null };
  if (!m) return { ...none, skip: true };

  const u = unwrapEnvelope(m);

  if (u.protocolMessage) return { ...none, skip: true };
  // Reactions arrive via their own messages.reaction event — that handler is
  // the source of truth; seeing one here is a skip.
  if (u.reactionMessage) return { ...none, skip: true };

  if (typeof u.conversation === 'string' && u.conversation.length > 0) {
    return { ...none, messageType: 'text', textContent: u.conversation, skip: false };
  }
  if (u.extendedTextMessage) {
    return {
      ...none,
      messageType: 'text',
      textContent: u.extendedTextMessage.text ?? null,
      quotedExternalId: u.extendedTextMessage.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }

  if (u.imageMessage) {
    const im = u.imageMessage;
    return {
      messageType: 'image',
      textContent: im.caption ?? null,
      mediaInfo: {
        type: 'image',
        mimeType: im.mimetype ?? null,
        fileName: null,
        sizeBytes: im.fileLength ? Number(im.fileLength) : null,
        extension: extensionFor(im.mimetype, null),
      },
      thumbBase64: thumbBase64(im),
      quotedExternalId: im.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (u.videoMessage) {
    const vm = u.videoMessage;
    return {
      messageType: 'video',
      textContent: vm.caption ?? null,
      mediaInfo: {
        type: 'video',
        mimeType: vm.mimetype ?? null,
        fileName: null,
        sizeBytes: vm.fileLength ? Number(vm.fileLength) : null,
        extension: extensionFor(vm.mimetype, null),
      },
      thumbBase64: thumbBase64(vm),
      quotedExternalId: vm.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (u.audioMessage) {
    const am = u.audioMessage;
    // Voice notes are OGG/Opus; default the mime AND derive the extension
    // from the effective value so the two can never disagree.
    const audioMime = am.mimetype ?? 'audio/ogg';
    return {
      messageType: 'audio',
      textContent: null,
      mediaInfo: {
        type: 'audio',
        mimeType: audioMime,
        fileName: null,
        sizeBytes: am.fileLength ? Number(am.fileLength) : null,
        extension: extensionFor(audioMime, null),
      },
      thumbBase64: null,
      quotedExternalId: am.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (u.documentMessage) {
    const dm = u.documentMessage;
    return {
      messageType: 'document',
      textContent: dm.caption ?? null,
      mediaInfo: {
        type: 'document',
        mimeType: dm.mimetype ?? null,
        fileName: dm.fileName ?? null,
        sizeBytes: dm.fileLength ? Number(dm.fileLength) : null,
        extension: extensionFor(dm.mimetype, dm.fileName),
      },
      thumbBase64: thumbBase64(dm),
      quotedExternalId: dm.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (u.stickerMessage) {
    const sm = u.stickerMessage;
    return {
      messageType: 'sticker',
      textContent: null,
      mediaInfo: {
        type: 'sticker',
        mimeType: sm.mimetype ?? 'image/webp',
        fileName: null,
        sizeBytes: sm.fileLength ? Number(sm.fileLength) : null,
        extension: 'webp',
      },
      thumbBase64: null,
      quotedExternalId: sm.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }

  // Unknown shape — keep the row (audit-trail complete); sanitised rawPayload
  // tells the operator what it actually was.
  return { ...none, skip: false };
}

// Strip raw binary buffers so the rawPayload column stays small + JSON-safe.
// Signal/encryption keys are useless for the audit archive — size markers only.
export function sanitiseRawPayload(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val instanceof Uint8Array) return `[binary:${val.length}b]`;
      if (val && typeof val === 'object' && 'low' in val && 'high' in val && 'unsigned' in val) {
        return Number(val).toString();
      }
      return val;
    }),
  );
}

// Phone digits from a JID — ONLY the @s.whatsapp.net suffix carries a real
// phone. @lid is an anonymous privacy id that LOOKS like a phone (the exact
// bug this strictness fixed in production), @g.us is a group, @broadcast/
// @newsletter are not phones. Anything else → null; callers must never fall
// back to the raw JID.
export function jidToPhone(jid) {
  if (!jid) return null;
  const at = jid.indexOf('@');
  if (at < 0) return null;
  if (jid.slice(at + 1) !== 's.whatsapp.net') return null;
  const before = jid.slice(0, at);
  const colon = before.indexOf(':');
  const phone = colon >= 0 ? before.slice(0, colon) : before;
  return /^\d+$/.test(phone) ? phone : null;
}

export function isGroupJid(jid) {
  return jid.endsWith('@g.us');
}

// Strict "this is a real phone" whitelist (cc + exact length) — used to decide
// whether a stored phoneNumber is real or stale LID garbage safe to overwrite.
export function isLikelyRealPhone(value) {
  if (!value || !/^\d+$/.test(value)) return false;
  if (value.length === 12 && value.startsWith('972')) return true; // Israel
  if (value.length === 11 && value.startsWith('1')) return true; // NANP
  if (value.length === 12 && value.startsWith('44')) return true; // UK
  return false;
}
