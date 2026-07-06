import crypto from 'node:crypto';

// AES-256-GCM encryption for OAuth tokens at rest (EmailAccount.*TokenEnc).
// Key material comes from the EMAIL_TOKEN_KEY env secret — any non-trivial
// string works (it is SHA-256-derived into a 32-byte key), so ops can set a
// long random passphrase without worrying about encodings. Stored format:
//   v1:<iv b64url>:<authTag b64url>:<ciphertext b64url>
// Rotating EMAIL_TOKEN_KEY invalidates stored tokens → accounts must be
// reconnected (same trade-off as rotating SESSION_SECRET for sessions).

const MIN_KEY_LEN = 16;

export function cryptoConfigured() {
  return (process.env.EMAIL_TOKEN_KEY || '').length >= MIN_KEY_LEN;
}

function deriveKey() {
  const secret = process.env.EMAIL_TOKEN_KEY || '';
  if (secret.length < MIN_KEY_LEN) {
    throw new Error(`EMAIL_TOKEN_KEY missing or shorter than ${MIN_KEY_LEN} chars`);
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptToken(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

export function decryptToken(stored) {
  if (!stored) return null;
  const [version, ivB64, tagB64, ctB64] = String(stored).split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('unrecognized encrypted token format');
  }
  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}
