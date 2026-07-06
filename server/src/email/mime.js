// MIME utilities for the Gmail mirror: parse the API's `full` payload tree
// into { bodyText, bodyHtml, attachments } and build RFC 2822 messages for
// users.messages.send. Hand-rolled (no mailparser/nodemailer) — the Gmail API
// already splits structure for us on read, and building is deterministic.

// ── Header helpers ────────────────────────────────────────────────────────────

export function headerMap(headers) {
  const map = {};
  for (const h of headers || []) {
    const key = String(h.name || '').toLowerCase();
    if (!(key in map)) map[key] = h.value ?? '';
  }
  return map;
}

// RFC 2047 encoded-words (=?charset?B|Q?...?=) — Hebrew names/subjects arrive
// encoded. Charset-aware via TextDecoder (Node 20 ships full ICU, so
// windows-1255/iso-8859-8 legacy Hebrew decodes too; utf-8 fallback).
function decodeCharset(buf, charset) {
  try {
    return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

export function decodeMimeWords(value) {
  if (!value || !value.includes('=?')) return value || '';
  return String(value)
    // Whitespace BETWEEN adjacent encoded words is ignored per RFC 2047.
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset, enc, text) => {
      try {
        if (enc.toLowerCase() === 'b') {
          return decodeCharset(Buffer.from(text, 'base64'), charset);
        }
        // Q-encoding: underscore = space, =XX hex bytes.
        const bytes = [];
        for (let i = 0; i < text.length; i += 1) {
          const c = text[i];
          if (c === '_') bytes.push(0x20);
          else if (c === '=' && i + 2 < text.length + 1) {
            bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
            i += 2;
          } else bytes.push(text.charCodeAt(i));
        }
        return decodeCharset(Buffer.from(bytes), charset);
      } catch {
        return text;
      }
    });
}

// "Dana Levi" <dana@x.com>, info@y.co.il → [{ email, name }]. Naive-but-robust:
// split on commas outside quotes/angle brackets, then pick the <addr> or bare
// address from each chunk.
export function parseAddressList(value) {
  const out = [];
  if (!value) return out;
  const chunks = [];
  let cur = '';
  let depth = 0;
  let inQuote = false;
  for (const ch of String(value)) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<' && !inQuote) depth += 1;
    else if (ch === '>' && !inQuote) depth = Math.max(0, depth - 1);
    if (ch === ',' && !inQuote && depth === 0) {
      chunks.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) chunks.push(cur);
  for (const chunk of chunks) {
    const m = /<([^<>]+)>/.exec(chunk);
    let email = null;
    let name = null;
    if (m) {
      email = m[1].trim();
      name = decodeMimeWords(chunk.slice(0, m.index).trim().replace(/^"|"$/g, '').trim()) || null;
    } else {
      const bare = /[^\s"<>,;]+@[^\s"<>,;]+/.exec(chunk);
      if (bare) email = bare[0];
    }
    if (email) out.push({ email: email.toLowerCase(), name: name || null });
  }
  return out;
}

export function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

// Re:/Fwd:/FW:/השב:/הועבר: prefixes (repeatedly) → bare subject for grouping.
export function normalizeSubject(subject) {
  let s = String(subject || '').trim();
  const re = /^(?:re|fw|fwd|השב|תגובה|הועבר)\s*:\s*/i;
  while (re.test(s)) s = s.replace(re, '');
  return s;
}

// ── Payload tree → bodies + attachments ──────────────────────────────────────

function decodeBody(part) {
  const data = part?.body?.data;
  if (!data) return '';
  const buf = Buffer.from(data, 'base64url');
  const ct = headerMap(part.headers)['content-type'] || '';
  const cs = /charset\s*=\s*"?([\w-]+)"?/i.exec(ct)?.[1];
  return decodeCharset(buf, cs);
}

export function parsePayload(payload) {
  const result = { bodyText: '', bodyHtml: '', attachments: [] };
  const walk = (part) => {
    if (!part) return;
    const mime = String(part.mimeType || '').toLowerCase();
    const filename = decodeMimeWords(part.filename || '');
    if (filename && part.body?.attachmentId) {
      // Real attachments AND inline images (cid) both land here — the CRM
      // lists them; cid: references in the HTML are stripped by the sanitizer.
      result.attachments.push({
        fileName: filename,
        mimeType: mime || null,
        sizeBytes: Number(part.body.size) || null,
        gmailAttachmentId: part.body.attachmentId,
        partId: part.partId || null,
      });
    } else if (mime === 'text/html' && !result.bodyHtml) {
      result.bodyHtml = decodeBody(part);
    } else if (mime === 'text/plain' && !result.bodyText) {
      result.bodyText = decodeBody(part);
    }
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  return result;
}

// ── Building outbound RFC 2822 ────────────────────────────────────────────────

export function encodeMimeWord(value) {
  const s = String(value || '');
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function formatAddress({ email, name }) {
  if (!name) return email;
  return `${encodeMimeWord(name)} <${email}>`;
}

function formatAddressList(list) {
  return (list || []).map(formatAddress).join(', ');
}

function b64Wrap(buf) {
  // 76-char lines per RFC 2045.
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

// Build the full message and return it base64url-encoded (the API's `raw`).
// attachments: [{ filename, mimeType, contentBase64 }].
export function buildRawMessage({
  from,
  to = [],
  cc = [],
  bcc = [],
  subject,
  bodyHtml,
  bodyText,
  inReplyTo,
  references,
  attachments = [],
}) {
  const alt = `alt_${Math.random().toString(36).slice(2)}`;
  const mixed = `mixed_${Math.random().toString(36).slice(2)}`;
  const lines = [];
  lines.push(`From: ${formatAddress(from)}`);
  if (to.length) lines.push(`To: ${formatAddressList(to)}`);
  if (cc.length) lines.push(`Cc: ${formatAddressList(cc)}`);
  if (bcc.length) lines.push(`Bcc: ${formatAddressList(bcc)}`);
  lines.push(`Subject: ${encodeMimeWord(subject || '')}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('MIME-Version: 1.0');

  const textPart = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Wrap(Buffer.from(bodyText || '', 'utf8')),
  ].join('\r\n');
  const htmlPart = [
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Wrap(Buffer.from(bodyHtml || '', 'utf8')),
  ].join('\r\n');

  let bodyBlock;
  if (bodyHtml && bodyText) {
    bodyBlock = [
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      '',
      `--${alt}`,
      textPart,
      `--${alt}`,
      htmlPart,
      `--${alt}--`,
    ].join('\r\n');
  } else if (bodyHtml) {
    bodyBlock = htmlPart;
  } else {
    bodyBlock = textPart;
  }

  let message;
  if (attachments.length) {
    const parts = [
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      '',
      `--${mixed}`,
      bodyBlock,
    ];
    for (const att of attachments) {
      parts.push(
        `--${mixed}`,
        [
          `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${encodeMimeWord(att.filename)}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${encodeMimeWord(att.filename)}"`,
          '',
          String(att.contentBase64 || '').replace(/(.{76})/g, '$1\r\n'),
        ].join('\r\n'),
      );
    }
    parts.push(`--${mixed}--`);
    message = [...lines, ...parts].join('\r\n');
  } else {
    // Body headers merge into the top-level headers when there's no wrapper.
    const [bodyHeaders, ...rest] = bodyBlock.split('\r\n\r\n');
    message = [...lines, bodyHeaders, '', rest.join('\r\n\r\n')].join('\r\n');
  }
  return Buffer.from(message, 'utf8').toString('base64url');
}

// Strip HTML → plain text fallback for multipart/alternative.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
