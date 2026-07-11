import crypto from 'node:crypto';
import * as r2 from '../../r2.js';

// Upload-readiness self-test — answers, in one call, "why do uploads fail?"
// by exercising the exact legs a browser upload uses:
//   serverPut      presigned PUT executed server-side → credentials /
//                  signature / bucket are valid (CORS not involved).
//   corsPreflight  OPTIONS with the app Origin — EXACTLY what the browser
//                  sends before its PUT. This is the leg that fails when the
//                  bucket has no CORS policy (R2 answers 403, browsers then
//                  block the PUT and every upload dies as a network error).
//   corsGet        cross-origin GET (lightbox/thumb fetches).
// The staff diagnostics endpoint runs this on demand and the gallery worker
// runs it once at startup so a missing bucket policy is LOUD in the logs
// instead of silently breaking every surface.

export const REQUIRED_CORS_DOC = 'docs/ops/tour-gallery-r2-cors.md';

export function appOrigin() {
  return process.env.CANONICAL_ORIGIN || 'https://app.grafitiyul.co.il';
}

export async function uploadReadinessSelfTest({
  storage = r2,
  origin = appOrigin(),
  fetchImpl = fetch,
} = {}) {
  const result = {
    r2Configured: storage.isConfigured(),
    origin,
    serverPut: null, // 'ok' | error string
    corsPreflight: null, // 'ok' | 'missing_cors_policy' | error string
    corsGet: null, // 'ok' | 'missing_cors_policy' | error string
    ready: false,
    requiredAction: null,
  };
  if (!result.r2Configured) {
    result.requiredAction = 'set R2_* env vars';
    return result;
  }
  const key = `tour-galleries/__selftest__/${crypto.randomBytes(8).toString('hex')}.txt`;
  try {
    const putUrl = await storage.presignPut({ key, contentType: 'text/plain', expiresIn: 120 });

    // 1. Signature/credentials (server-side PUT — no CORS in play).
    try {
      const putRes = await fetchImpl(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'selftest',
      });
      result.serverPut = putRes.ok ? 'ok' : `http_${putRes.status}`;
    } catch (e) {
      result.serverPut = `error: ${e?.message || e}`;
    }

    // 2. Browser-equivalent preflight.
    try {
      const pre = await fetchImpl(putUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      const allowed = pre.headers.get('access-control-allow-origin');
      result.corsPreflight = allowed ? 'ok' : 'missing_cors_policy';
    } catch (e) {
      result.corsPreflight = `error: ${e?.message || e}`;
    }

    // 3. Cross-origin GET (view/thumb URLs).
    try {
      const getUrl = await storage.presignGet({ key, expiresIn: 120 });
      const getRes = await fetchImpl(getUrl, { headers: { Origin: origin } });
      const allowed = getRes.headers.get('access-control-allow-origin');
      result.corsGet = getRes.ok ? (allowed ? 'ok' : 'missing_cors_policy') : `http_${getRes.status}`;
    } catch (e) {
      result.corsGet = `error: ${e?.message || e}`;
    }
  } finally {
    await storage.deleteObject(key);
  }

  result.ready = result.serverPut === 'ok' && result.corsPreflight === 'ok';
  if (!result.ready) {
    result.requiredAction =
      result.serverPut !== 'ok'
        ? 'R2 credentials/bucket problem — check R2_* env vars'
        : `bucket CORS policy missing — apply the policy in ${REQUIRED_CORS_DOC} (Cloudflare dashboard → R2 → bucket → Settings → CORS)`;
  }
  return result;
}
