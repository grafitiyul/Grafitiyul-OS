// Ingress Platform — THE shared signature/authentication layer.
//
// Every source authenticates differently in encoding but identically in shape:
// an HMAC-SHA256 of the EXACT raw request body under a shared secret. Doing it
// once here means no adapter can accidentally ship a weaker check — and no
// adapter re-implements constant-time comparison.
//
// Raw body, not the parsed object: JSON.stringify(req.body) re-serializes with
// different key order/spacing and will not reproduce the provider's bytes. The
// route layer must capture the raw buffer (express.json({ verify })).

import crypto from 'node:crypto';
import { ingressError, STAGES } from './errors.js';

// Constant-time compare that never throws on length mismatch (timingSafeEqual
// requires equal lengths, so a naive call leaks length via an exception).
export function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  if (A.length !== B.length) {
    // Still burn a comparison so timing does not distinguish "wrong length"
    // from "wrong value".
    crypto.timingSafeEqual(A, A);
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

export function hmacHex(rawBody, secret) {
  return crypto.createHmac('sha256', String(secret)).update(rawBody ?? Buffer.alloc(0)).digest('hex');
}

export function hmacBase64(rawBody, secret) {
  return crypto.createHmac('sha256', String(secret)).update(rawBody ?? Buffer.alloc(0)).digest('base64');
}

/**
 * Meta / Facebook: `X-Hub-Signature-256: sha256=<hex>`
 */
export function verifyMetaSignature({ rawBody, header, appSecret }) {
  if (!appSecret) throw ingressError('signature_secret_missing', { stage: STAGES.VALIDATE });
  const provided = String(header || '');
  if (!provided.startsWith('sha256=')) {
    throw ingressError('signature_invalid', { stage: STAGES.VALIDATE, detail: 'missing sha256= prefix' });
  }
  if (!safeEqual(provided.slice('sha256='.length), hmacHex(rawBody, appSecret))) {
    throw ingressError('signature_invalid', { stage: STAGES.VALIDATE });
  }
  return true;
}

/**
 * WooCommerce: `X-WC-Webhook-Signature: <base64>`
 */
export function verifyWooSignature({ rawBody, header, secret }) {
  if (!secret) throw ingressError('signature_secret_missing', { stage: STAGES.VALIDATE });
  if (!header) throw ingressError('signature_invalid', { stage: STAGES.VALIDATE, detail: 'header absent' });
  if (!safeEqual(String(header), hmacBase64(rawBody, secret))) {
    throw ingressError('signature_invalid', { stage: STAGES.VALIDATE });
  }
  return true;
}

/**
 * Website forms. Elementor cannot compute an HMAC, so these authenticate with a
 * shared secret carried in the URL path or an `X-GOS-Secret` header — the same
 * pattern the existing Cardcom/iCount receivers use. Compared in constant time.
 *
 * When an HMAC signature IS present we verify it instead: that lets a future
 * WordPress snippet upgrade to real signing with no change here.
 */
export function verifyWebsiteFormAuth({ rawBody, providedSecret, signatureHeader, secret }) {
  if (!secret) throw ingressError('signature_secret_missing', { stage: STAGES.VALIDATE });
  if (signatureHeader) {
    if (!safeEqual(String(signatureHeader), hmacBase64(rawBody, secret))) {
      throw ingressError('signature_invalid', { stage: STAGES.VALIDATE });
    }
    return true;
  }
  if (!safeEqual(String(providedSecret ?? ''), String(secret))) {
    throw ingressError('signature_invalid', { stage: STAGES.VALIDATE, detail: 'shared secret mismatch' });
  }
  return true;
}
