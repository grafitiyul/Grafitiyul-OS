import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { getPublishedBySlug } from '../sitePages/service.js';
import { renderPublicPageHtml, renderNotFoundHtml, buildSitemapXml } from '../sitePages/publicPage.js';
import { sitePageUrl } from '../publicLinks.js';

// PUBLIC HTML pages on the GOS domain — /pages/:slug. ONE generic route for
// every SitePage; the slug is the only variable. Same source of truth as the
// JSON API (getPublishedBySlug → the frozen published version), same renderer,
// wrapped in the public shell (publicPage.js). No auth, no draft access —
// drafts are not addressable through getPublishedBySlug at all.
//
// Caching: documents are `no-store` (project rule 15); there are no cacheable
// assets on these pages (styles are inline, images are content-stable R2 URLs).

const router = Router();

router.get('/sitemap.xml', handle(async (_req, res) => {
  const rows = await prisma.sitePage.findMany({
    where: { status: 'published', publishedVersionId: { not: null } },
    select: { slug: true, publishedAt: true, publishedVersion: { select: { content: true } } },
    orderBy: { publishedAt: 'desc' },
  });
  const pages = rows.map((r) => ({
    slug: r.slug,
    publishedAt: r.publishedAt,
    noindex: r.publishedVersion?.content?.seo?.noindex === true,
  }));
  res.set('Cache-Control', 'no-store');
  res.type('application/xml').send(buildSitemapXml(pages, sitePageUrl));
}));

router.get('/:slug', handle(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const published = await getPublishedBySlug(req.params.slug);
  if (!published) return res.status(404).type('html').send(renderNotFoundHtml());

  const { html, status } = renderPublicPageHtml(published, {
    langParam: req.query.lang,
    canonicalUrl: sitePageUrl(published.slug),
  });
  res.status(status).type('html').send(html);
}));

export default router;
