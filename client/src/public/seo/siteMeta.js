// ============================================================================
// Site-wide SEO defaults.
//
// These are the fallbacks every page inherits. Per-page <Seo> props override
// them. When the WordPress export arrives, real titles/descriptions/OG images
// (and the canonical base) are filled in HERE and via per-page props — no
// component changes needed. This is the main "absorb WP SEO later" hook.
// ============================================================================

export const siteMeta = {
  name: 'גרפיטיול',
  // Canonical origin for absolute canonical + OG URLs (public marketing pages).
  // Config-driven: set VITE_PUBLIC_BASE_URL at build time to the public
  // marketing domain; the literal is only the fallback when it is unset. This
  // is the ONE absolute URL the app hardcodes — every functional link (OAuth
  // callback, payment, tracking pixel, portal, deep links) derives from
  // PUBLIC_ORIGIN (server) or window.location.origin (client) instead.
  baseUrl:
    (import.meta.env.VITE_PUBLIC_BASE_URL || 'https://www.grafitiyul.co.il').replace(/\/+$/, ''),
  defaultTitle: 'גרפיטיול — סיורי וסדנאות גרפיטי',
  titleTemplate: '%s | גרפיטיול',
  defaultDescription:
    'סיורי גרפיטי וסדנאות אורבניות בלב הסצנה. הזמינו חוויה צבעונית עם גרפיטיול.',
  defaultOgImage: '/og-default.jpg', // resolved via the media seam later
  locale: 'he_IL',
  dir: 'rtl',
  twitter: '@grafitiyul', // placeholder
};
