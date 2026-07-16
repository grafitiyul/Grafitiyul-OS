import test from 'node:test';
import assert from 'node:assert/strict';

// config.js validates required env at import time; satisfy it BEFORE the
// dynamic imports below (media.js → config.js).
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.WHATSAPP_ACCOUNT_ID ||= 'test_account';
process.env.BRIDGE_INTERNAL_SECRET ||= 'test-secret';

const { extractContent, jidToPhone, isGroupJid, isExcludedChatJid, isLikelyRealPhone, sanitiseRawPayload } =
  await import('./extract.js');
const { buildMediaKey } = await import('./media.js');

const msg = (message, key = { id: 'MSG1', remoteJid: '972501234567@s.whatsapp.net' }) => ({ key, message });

// ── extractContent ───────────────────────────────────────────────────────────
test('extract: plain conversation text', () => {
  const c = extractContent(msg({ conversation: 'שלום!' }));
  assert.equal(c.messageType, 'text');
  assert.equal(c.textContent, 'שלום!');
  assert.equal(c.mediaInfo, null);
  assert.equal(c.skip, false);
});

test('extract: extended text carries the quoted-reply target', () => {
  const c = extractContent(msg({
    extendedTextMessage: { text: 'תשובה', contextInfo: { stanzaId: 'QUOTED1' } },
  }));
  assert.equal(c.messageType, 'text');
  assert.equal(c.quotedExternalId, 'QUOTED1');
});

test('extract: image → media info + caption + embedded thumbnail', () => {
  const thumb = new Uint8Array([1, 2, 3, 4]);
  const c = extractContent(msg({
    imageMessage: { mimetype: 'image/jpeg', caption: 'תמונה מהסיור', fileLength: 12345, jpegThumbnail: thumb },
  }));
  assert.equal(c.messageType, 'image');
  assert.equal(c.textContent, 'תמונה מהסיור');
  assert.deepEqual(
    { type: c.mediaInfo.type, mime: c.mediaInfo.mimeType, ext: c.mediaInfo.extension, size: c.mediaInfo.sizeBytes },
    { type: 'image', mime: 'image/jpeg', ext: 'jpg', size: 12345 },
  );
  assert.equal(c.thumbBase64, Buffer.from(thumb).toString('base64'));
});

test('extract: voice note defaults to audio/ogg', () => {
  const c = extractContent(msg({ audioMessage: { ptt: true } }));
  assert.equal(c.messageType, 'audio');
  assert.equal(c.mediaInfo.mimeType, 'audio/ogg');
  assert.equal(c.mediaInfo.extension, 'ogg');
});

test('extract: document keeps original filename and infers extension from it', () => {
  const c = extractContent(msg({
    documentMessage: { fileName: 'הצעת מחיר.PDF', mimetype: 'application/pdf', fileLength: 999 },
  }));
  assert.equal(c.messageType, 'document');
  assert.equal(c.mediaInfo.fileName, 'הצעת מחיר.PDF');
  assert.equal(c.mediaInfo.extension, 'pdf');
});

test('extract: sticker is webp media', () => {
  const c = extractContent(msg({ stickerMessage: { mimetype: 'image/webp' } }));
  assert.equal(c.messageType, 'sticker');
  assert.equal(c.mediaInfo.extension, 'webp');
});

test('extract: protocol/reaction chatter is skipped; unknown shapes are kept as system', () => {
  assert.equal(extractContent(msg({ protocolMessage: {} })).skip, true);
  assert.equal(extractContent(msg({ reactionMessage: {} })).skip, true);
  assert.equal(extractContent(msg(null)).skip, true);
  const unknown = extractContent(msg({ somethingNew: {} }));
  assert.equal(unknown.skip, false);
  assert.equal(unknown.messageType, 'system');
});

test('extract: viewOnce/ephemeral envelopes are unwrapped', () => {
  const c = extractContent(msg({
    ephemeralMessage: { message: { conversation: 'הודעה נעלמת' } },
  }));
  assert.equal(c.messageType, 'text');
  assert.equal(c.textContent, 'הודעה נעלמת');
});

// ── jidToPhone strictness (the @lid-looks-like-a-phone production bug) ──────
test('jidToPhone: only @s.whatsapp.net yields a phone', () => {
  assert.equal(jidToPhone('972501234567@s.whatsapp.net'), '972501234567');
  assert.equal(jidToPhone('972501234567:3@s.whatsapp.net'), '972501234567'); // device suffix
  assert.equal(jidToPhone('240359288365074@lid'), null); // privacy id, NOT a phone
  assert.equal(jidToPhone('12345-67890@g.us'), null); // group
  assert.equal(jidToPhone('x@broadcast'), null);
  assert.equal(jidToPhone(null), null);
});

test('isGroupJid / isLikelyRealPhone', () => {
  assert.equal(isGroupJid('12345@g.us'), true);
  assert.equal(isGroupJid('972501234567@s.whatsapp.net'), false);
  assert.equal(isLikelyRealPhone('972501234567'), true);
  assert.equal(isLikelyRealPhone('240359288365074'), false); // LID digits
});

// ── isExcludedChatJid (Status / broadcast / channel exclusion) ─────────────
test('isExcludedChatJid: WhatsApp Status is excluded', () => {
  assert.equal(isExcludedChatJid('status@broadcast'), true);
});

test('isExcludedChatJid: broadcast lists and channels are excluded', () => {
  assert.equal(isExcludedChatJid('1234567890@broadcast'), true);
  assert.equal(isExcludedChatJid('120363000000000000@newsletter'), true);
});

test('isExcludedChatJid: a missing/empty jid fails safe (excluded)', () => {
  assert.equal(isExcludedChatJid(null), true);
  assert.equal(isExcludedChatJid(undefined), true);
  assert.equal(isExcludedChatJid(''), true);
});

test('isExcludedChatJid: real private and group conversations are NOT excluded', () => {
  assert.equal(isExcludedChatJid('972501234567@s.whatsapp.net'), false);
  assert.equal(isExcludedChatJid('972501234567:3@s.whatsapp.net'), false); // device suffix
  assert.equal(isExcludedChatJid('240359288365074@lid'), false); // privacy id, still a real 1:1
  assert.equal(isExcludedChatJid('12345-67890@g.us'), false); // group
});

// ── sanitiseRawPayload ───────────────────────────────────────────────────────
test('sanitiseRawPayload replaces binary buffers with size markers', () => {
  const out = sanitiseRawPayload({ a: new Uint8Array(32), b: 'text', nested: { k: new Uint8Array(5) } });
  assert.equal(out.a, '[binary:32b]');
  assert.equal(out.b, 'text');
  assert.equal(out.nested.k, '[binary:5b]');
});

// ── media key contract (purge + serving depend on the prefix) ───────────────
test('buildMediaKey starts with whatsapp/<accountId>/ and is URL-safe', () => {
  const key = buildMediaKey('personal_test', '972501234567@s.whatsapp.net', 'ABC==/1', 'jpg', new Date('2026-07-05T10:00:00Z'));
  assert.ok(key.startsWith('whatsapp/personal_test/2026/07/'));
  assert.match(key, /\.jpg$/);
  assert.ok(!key.includes('@') && !key.includes('='), 'jid/base64 punctuation neutralised');
});
