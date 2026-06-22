import { siteMeta } from './siteMeta.js';

// Pure builder: turns per-page SEO props into a serialisable description of the
// document <head>. ZERO side effects — this is deliberately shared by BOTH:
//   * the client <Seo> component (applies it imperatively today), and
//   * the SSR head renderer (Step 3/Vike) which will stringify it server-side.
//
// Keeping the logic here means SEO output is identical in CSR and SSR.
//
// props: { title, description, canonical, path, image, noindex, type, jsonLd }
export function buildHead(props = {}) {
  const {
    title,
    description = siteMeta.defaultDescription,
    canonical,
    path,
    image = siteMeta.defaultOgImage,
    noindex = false,
    type = 'website',
    jsonLd,
  } = props;

  const fullTitle = title
    ? siteMeta.titleTemplate.replace('%s', title)
    : siteMeta.defaultTitle;

  const url =
    canonical || (path ? `${siteMeta.baseUrl}${path}` : siteMeta.baseUrl);
  const absImage = /^https?:/i.test(image) ? image : `${siteMeta.baseUrl}${image}`;

  const metas = [
    { name: 'description', content: description },
    { property: 'og:type', content: type },
    { property: 'og:site_name', content: siteMeta.name },
    { property: 'og:title', content: fullTitle },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: absImage },
    { property: 'og:locale', content: siteMeta.locale },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: fullTitle },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: absImage },
  ];

  if (noindex) metas.push({ name: 'robots', content: 'noindex, nofollow' });

  const links = [{ rel: 'canonical', href: url }];

  // jsonLd may be a single object or an array; normalise to an array of objects.
  const jsonLdBlocks = jsonLd
    ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
    : [];

  return { title: fullTitle, metas, links, jsonLd: jsonLdBlocks };
}
