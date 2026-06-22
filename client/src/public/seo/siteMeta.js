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
  // Canonical origin. Placeholder until the production domain is confirmed at
  // cutover; used to build absolute canonical + OG URLs.
  baseUrl: 'https://www.grafitiyul.co.il',
  defaultTitle: 'גרפיטיול — סיורי וסדנאות גרפיטי',
  titleTemplate: '%s | גרפיטיול',
  defaultDescription:
    'סיורי גרפיטי וסדנאות אורבניות בלב הסצנה. הזמינו חוויה צבעונית עם גרפיטיול.',
  defaultOgImage: '/og-default.jpg', // resolved via the media seam later
  locale: 'he_IL',
  dir: 'rtl',
  twitter: '@grafitiyul', // placeholder
};
