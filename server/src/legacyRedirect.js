// Legacy-domain → canonical-domain 301 redirect logic (pure + testable).
//
// After the cutover to the official domain, requests still arriving on the old
// Railway public host are permanently redirected to the SAME path+query on the
// canonical origin — so already-distributed links keep working:
//   /pay/<token>                       (payment links given to customers)
//   /p/<token>                         (guide portal links already shared)
//   /api/track/email-open/<id>.gif     (tracking pixels in already-sent mail)
//   /admin/…                           (bookmarks)
//
// Scope is deliberately narrow — ONLY an exact match on the legacy PUBLIC host
// redirects. Internal traffic never matches, so nothing internal is affected:
//   • bridge ↔ server calls use *.railway.internal hosts
//   • the new canonical domain passes straight through
//   • localhost / empty host pass through
// /health is exempted so Railway's health probe is never handed a 3xx (some
// probes treat a redirect as unhealthy). A misconfiguration where the canonical
// host equals the legacy host disables the redirect entirely (no loop).

// makeLegacyRedirect returns a function (hostHeader, path, originalUrl) → the
// absolute redirect target string, or null when the request should pass
// through untouched.
export function makeLegacyRedirect({ canonicalOrigin, legacyHost } = {}) {
  const origin = String(canonicalOrigin || '').trim().replace(/\/+$/, '');
  const legacy = String(legacyHost || '').trim().toLowerCase();

  let canonicalHost = '';
  try {
    canonicalHost = new URL(origin).host.toLowerCase();
  } catch {
    /* invalid/empty origin → feature stays disabled */
  }

  // Enabled only when both are set AND distinct (equal hosts would loop).
  const enabled = !!legacy && !!canonicalHost && canonicalHost !== legacy;

  return function legacyRedirectTarget(hostHeader, reqPath, originalUrl) {
    if (!enabled) return null;
    // Host header without port, lowercased, for a stable exact compare.
    const host = String(hostHeader || '').split(':')[0].trim().toLowerCase();
    if (host !== legacy) return null;
    if (reqPath === '/health') return null; // never redirect the health probe
    return `${origin}${originalUrl}`;
  };
}
