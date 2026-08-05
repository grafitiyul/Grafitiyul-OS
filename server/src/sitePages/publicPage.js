import { localeContentCount } from '../../../shared/sitePage.mjs';
import { renderPage, pageStructuredData, pageStylesheet } from './render.js';

// The public GOS-domain page for "דפי אתר" — ONE generic server-rendered shell
// around the existing renderer, used for every SitePage (no per-slug routes).
// Until the WordPress half is installed this IS the public home of the pages;
// afterwards it stays a valid mirror (the canonical URL is owned by
// publicLinks.js in exactly one place).
//
// Everything here is pure — the route hands in the published payload from
// getPublishedBySlug and gets back { html, status, locale }.

const LOCALES = ['he', 'en'];

/**
 * The language the page opens in. An explicit ?lang= always wins and survives
 * refresh/deep links; otherwise the page's configured defaultLanguage. Never
 * the browser's Accept-Language — an explicit choice must not be second-guessed.
 */
export function resolveLocale(defaultLanguage, langParam) {
  if (LOCALES.includes(langParam)) return langParam;
  return LOCALES.includes(defaultLanguage) ? defaultLanguage : 'he';
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Minimal public chrome: brand, language switcher, content, footer. Scoped
// styles shipped inline with the page (rule 15: the document itself is
// no-store; only content-hashed/immutable assets may cache, and there are none).
const SHELL_CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1c2430;background:#fff;-webkit-font-smoothing:antialiased}
.gos-shell__header{border-bottom:1px solid rgba(28,36,48,.12);background:#fff;position:sticky;top:0;z-index:5}
.gos-shell__bar{max-width:1080px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.gos-shell__brand{text-decoration:none;color:inherit;font-weight:700;font-size:1.05rem;letter-spacing:.2px;display:flex;align-items:baseline;gap:8px}
.gos-shell__brand small{font-weight:500;opacity:.6;font-size:.85rem}
.gos-shell__lang{display:flex;align-items:center;gap:10px;font-size:.95rem}
.gos-shell__lang a{text-decoration:none;color:inherit;opacity:.55;padding:4px 2px}
.gos-shell__lang a[aria-current="true"]{opacity:1;font-weight:700;border-bottom:2px solid currentColor}
.gos-shell__lang a:hover{opacity:1}
.gos-shell__main{min-height:60vh;padding-top:8px}
.gos-shell__footer{border-top:1px solid rgba(28,36,48,.12);margin-top:48px}
.gos-shell__footer div{max-width:1080px;margin:0 auto;padding:18px 16px;font-size:.85rem;opacity:.65;display:flex;gap:14px;flex-wrap:wrap}
.gos-shell__footer a{color:inherit}
.gos-shell__soon{max-width:640px;margin:0 auto;padding:64px 16px;text-align:center}
.gos-shell__soon h1{font-size:1.6rem;margin:0 0 .4em}
.gos-shell__soon p{opacity:.75;margin:0 0 1.4em}
.gos-shell__soon a{display:inline-block;padding:10px 22px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-weight:600}
`.trim();

function langSwitcher(locale) {
  const link = (code, label, dir) =>
    `<a href="?lang=${code}" lang="${code}" dir="${dir}" hreflang="${code}"` +
    `${locale === code ? ' aria-current="true"' : ''}>${label}</a>`;
  return (
    `<nav class="gos-shell__lang" aria-label="Language / שפה">` +
    link('he', 'עברית', 'rtl') +
    `<span aria-hidden="true">·</span>` +
    link('en', 'English', 'ltr') +
    `</nav>`
  );
}

function shell({ locale, head, body }) {
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  return (
    `<!doctype html><html lang="${locale}" dir="${dir}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    head +
    `<style>${SHELL_CSS}\n${pageStylesheet}</style></head>` +
    `<body>` +
    `<header class="gos-shell__header"><div class="gos-shell__bar">` +
    `<a class="gos-shell__brand" href="https://grafitiyul.co.il">Grafitiyul <small>גרפיטיול</small></a>` +
    langSwitcher(locale) +
    `</div></header>` +
    `<main class="gos-shell__main">${body}</main>` +
    `<footer class="gos-shell__footer"><div>` +
    `<span>© Grafitiyul · גרפיטיול</span>` +
    `<a href="https://grafitiyul.co.il" rel="noopener">grafitiyul.co.il</a>` +
    `</div></footer>` +
    `</body></html>`
  );
}

function headTags({ title, seo, noindex, canonical, structuredData }) {
  const parts = [`<title>${esc(title || 'Grafitiyul')}</title>`];
  // noindex implies nofollow here: an unlisted page must not leak link equity
  // either. Indexable pages get no robots tag at all (default index,follow).
  if (noindex) parts.push(`<meta name="robots" content="noindex,nofollow">`);
  if (seo?.description) parts.push(`<meta name="description" content="${esc(seo.description)}">`);
  if (canonical) parts.push(`<link rel="canonical" href="${esc(canonical)}">`);
  if (!noindex && canonical) {
    for (const code of LOCALES) {
      parts.push(`<link rel="alternate" hreflang="${code}" href="${esc(canonical)}?lang=${code}">`);
    }
  }
  if (seo?.ogTitle) parts.push(`<meta property="og:title" content="${esc(seo.ogTitle)}">`);
  if (seo?.ogDescription) parts.push(`<meta property="og:description" content="${esc(seo.ogDescription)}">`);
  if (seo?.ogImage) parts.push(`<meta property="og:image" content="${esc(seo.ogImage)}">`);
  if (canonical) parts.push(`<meta property="og:url" content="${esc(canonical)}">`);
  if (seo?.locale) parts.push(`<meta property="og:locale" content="${esc(seo.locale)}">`);
  if (structuredData) {
    parts.push(`<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`);
  }
  return parts.join('');
}

const SOON = {
  en: {
    title: 'English version coming soon',
    body: 'This page is not yet available in English.',
    cta: 'לצפייה בעברית · View in Hebrew',
    to: 'he',
  },
  he: {
    title: 'הגרסה בעברית תעלה בקרוב',
    body: 'העמוד הזה עדיין לא זמין בעברית.',
    cta: 'View in English · לצפייה באנגלית',
    to: 'en',
  },
};

/**
 * Render one published page into a complete public HTML document.
 * `published` is getPublishedBySlug's payload. Returns { html, status, locale }.
 *
 * A locale with NO publishable content (strict rendering — no cross-language
 * fallback exists anywhere) gets an honest "coming soon" page: never a mixed-
 * language page, never a hard 404 for a page that exists in the other language.
 */
export function renderPublicPageHtml(published, { langParam, canonicalUrl = '' } = {}) {
  const locale = resolveLocale(published.defaultLanguage, langParam);

  if (localeContentCount(published.content, locale) === 0) {
    const t = SOON[locale];
    const body =
      `<div class="gos-shell__soon"><h1>${t.title}</h1><p>${t.body}</p>` +
      `<a href="?lang=${t.to}">${t.cta}</a></div>`;
    // The placeholder variant is never indexable, whatever the page's own SEO
    // says — an empty page in the index helps no one.
    const head = headTags({ title: t.title, noindex: true, canonical: '' });
    return { html: shell({ locale, head, body }), status: 200, locale, comingSoon: true };
  }

  const { html, seo } = renderPage(published.content, { locale });
  const structuredData = pageStructuredData(published.content, { locale });
  const head = headTags({
    title: seo.title,
    seo,
    noindex: seo.noindex === true,
    canonical: seo.canonical || canonicalUrl,
    structuredData,
  });
  return { html: shell({ locale, head, body: html }), status: 200, locale, comingSoon: false };
}

/** The public 404 — same shell, no content details. */
export function renderNotFoundHtml() {
  const body =
    `<div class="gos-shell__soon"><h1>הדף לא נמצא · Page not found</h1>` +
    `<p>ייתכן שהכתובת השתנתה או שהעמוד ירד מהאתר.</p>` +
    `<a href="https://grafitiyul.co.il">grafitiyul.co.il</a></div>`;
  const head = headTags({ title: 'הדף לא נמצא · Grafitiyul', noindex: true });
  return shell({ locale: 'he', head, body });
}

/**
 * sitemap.xml for the GOS-hosted pages: indexable published pages only —
 * a noindex page (e.g. the agents price list) must never appear here.
 */
export function buildSitemapXml(pages, urlFor) {
  const urls = pages
    .filter((p) => !p.noindex)
    .map(
      (p) =>
        `<url><loc>${esc(urlFor(p.slug))}</loc>` +
        (p.publishedAt ? `<lastmod>${new Date(p.publishedAt).toISOString().slice(0, 10)}</lastmod>` : '') +
        `</url>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
