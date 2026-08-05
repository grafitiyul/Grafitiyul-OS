// THE registry of first-path-segment names a SitePage slug may NEVER use.
//
// Public pages are served at the domain ROOT (/:slug), directly beside every
// application route. Express ordering already guarantees that anything mounted
// before the page route wins — this registry is the second, explicit fence:
// the page route refuses reserved names before touching the database, and the
// admin write path refuses to CREATE a page with one, so a future page can
// never shadow a system route even if mounting order changes.
//
// Add here FIRST whenever a new root-level route or client-side root path is
// introduced. Names are matched case-insensitively on the first path segment.

export const RESERVED_SLUGS = new Set([
  // server-owned roots
  'api', 'health', 'version.json', 'manifest.webmanifest',
  'payment', 'pay', 'pages', 'webhooks', 'track',
  // static build artefacts
  'assets', 'icons', 'index.html', 'favicon.ico', 'robots.txt',
  'sitemap.xml', 'sw.js', 'static', 'uploads', 'media',
  // client-side root routes (App.jsx)
  'admin', 'login', 'launch', 'flow', 'attempt', 'preview',
  'p', 'g', 'r', 'f', 'form', 'quote', 'install-guide', 'portal', 'auth',
]);

export function isReservedSlug(slug) {
  const first = String(slug || '')
    .replace(/^\/+/, '')
    .split('/')[0]
    .toLowerCase();
  return RESERVED_SLUGS.has(first);
}
