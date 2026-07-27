// Decode a part out of a base64url-encoded RFC 2822 message (the shape
// buildRawMessage returns). Base64 bodies are wrapped at 76 chars per RFC 2045,
// so the lines MUST be joined before decoding — decoding them individually
// yields garbage as soon as the payload exceeds one line.
export function decodePart(raw, contentType = 'text/html') {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const at = mime.search(new RegExp(`Content-Type:\\s*${contentType.replace('/', '\\/')}`, 'i'));
  if (at < 0) return '';
  const afterHeaders = mime.slice(at).split(/\r\n\r\n/).slice(1).join('\r\n\r\n');
  const b64 = afterHeaders.split(/\r\n--/)[0].replace(/[\r\n]/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

export const htmlPartOf = (raw) => decodePart(raw, 'text/html');
export const textPartOf = (raw) => decodePart(raw, 'text/plain');
