// Pure root/launch token resolution — deliberately storage-free.
//
// SECURITY INVARIANT (incident 2026-07-13): the bare root "/" and the
// launcher "/launch" resolve a guide-portal token ONLY from the explicit
// URL — a path segment (/launch/:token) or the ?p=<token> query. They must
// NEVER read a device-global "last portal token" from localStorage /
// sessionStorage / cookies and redirect into a guide portal.
//
// Why: previously Landing fell back to localStorage['gos.portalToken'], so a
// device that had ever opened one guide's /p/:token link would, on the bare
// domain, silently redirect into THAT guide's portal. Portal identity is
// URL-token scoped, not device-global.
//
// This function takes only the URL-derived inputs and has no storage access
// at all, so the invariant is structurally guaranteed (and unit-tested).
//
// Returns one of:
//   { kind: 'portal', to: '/p/<token>' }  — a valid token was in the URL
//   { kind: 'admin',  to: '/admin' }      — bare root, no URL token
//   { kind: 'missing' }                   — launcher, no URL token (fail closed)

const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

export function resolveLanding({ pathToken, queryToken, isLaunchPath }) {
  const token =
    (typeof pathToken === 'string' && TOKEN_RE.test(pathToken) && pathToken) ||
    (typeof queryToken === 'string' && TOKEN_RE.test(queryToken) && queryToken) ||
    null;

  if (token) {
    return { kind: 'portal', to: `/p/${encodeURIComponent(token)}` };
  }
  // No token in the URL. The bare root sends admins to the admin flow
  // (which then handles login); the launcher fails closed to a guide-facing
  // "no personal link" screen. Neither infers a token from device storage.
  if (!isLaunchPath) {
    return { kind: 'admin', to: '/admin' };
  }
  return { kind: 'missing' };
}
