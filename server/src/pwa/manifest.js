// PWA manifest builder — the SINGLE source of truth for both the admin app
// manifest and per-guide portal manifests.
//
// SECURITY / ISOLATION INVARIANTS (incident 2026-07-13):
//   * Content is a PURE function of the explicit token argument (the ?p=
//     query value) — never of cookies, sessions, or "the last token this
//     process resolved". Two manifests can never bleed into each other.
//   * No token (or a malformed one) ALWAYS yields the ADMIN manifest
//     (start_url /admin). The most-recently-generated guide manifest can
//     never become the global/default manifest served at the bare
//     /manifest.webmanifest URL.
//   * Each manifest carries a STABLE, identity-safe `id`, so the browser
//     files the admin PWA and each guide PWA as distinct installs — one can
//     never overwrite another.

const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

const THEME_COLOR = '#28a8a8';
const BACKGROUND_COLOR = '#f9fafb';

// Real Grafitiyul Team logo PNGs (see client/public/icons/*).
const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

const BASE = {
  name: 'Grafitiyul Team',
  short_name: 'Grafitiyul Team',
  description: 'מערכת התפעול והלמידה של גרפיתי-יול',
  lang: 'he',
  dir: 'rtl',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: BACKGROUND_COLOR,
  theme_color: THEME_COLOR,
  icons: ICONS,
};

// Stable, admin-specific install identity. Distinct from every guide id.
export const ADMIN_MANIFEST_ID = '/?app=grafitiyul-admin';

export function adminManifest() {
  return {
    ...BASE,
    id: ADMIN_MANIFEST_ID,
    // The admin PWA opens the full authenticated admin app. AdminGuard
    // handles the login redirect when unauthenticated; after login the
    // /admin index routes to Operations Control (בקרה).
    start_url: '/admin',
  };
}

export function guideManifest(token) {
  return {
    ...BASE,
    // Token-scoped identity — a distinct install per guide, and distinct
    // from the admin id, so installs never overwrite each other.
    id: `/p/${token}`,
    // Path-based launch URL: iOS preserves path segments through the
    // standalone launch even when it strips queries or ignores start_url.
    // The Landing route redirects /launch/:token → /p/:token. This token
    // lives ONLY inside this one guide's own manifest URL.
    start_url: `/launch/${encodeURIComponent(token)}`,
  };
}

// The single entry point the HTTP layer calls. `rawToken` is the ?p= query
// value (or null/undefined). Anything not matching the token shape → admin.
export function buildManifest(rawToken) {
  const token =
    typeof rawToken === 'string' && TOKEN_RE.test(rawToken) ? rawToken : null;
  return token ? guideManifest(token) : adminManifest();
}
