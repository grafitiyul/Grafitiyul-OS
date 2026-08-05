import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { getPublishedBySlug } from '../sitePages/service.js';
import { renderPublicPageHtml, buildSitemapXml } from '../sitePages/publicPage.js';
import { isReservedSlug } from '../sitePages/reservedSlugs.js';
import { sitePageUrl } from '../publicLinks.js';

// PUBLIC website pages at the domain ROOT — /:slug (owner correction
// 2026-08-05: clean URLs, no /pages prefix). ONE generic route for every
// SitePage. Two fences keep it collision-free:
//   1. Mounting order — this router sits AFTER every API/static/system route,
//      so an existing route always wins before we are even consulted.
//   2. reservedSlugs.js — reserved first segments are refused here without a
//      DB lookup AND refused at page creation, so a future page cannot shadow
//      a client-side route the server would otherwise have fallen through to.
// A slug that is neither reserved nor a published page falls through (next())
// to the SPA fallback — exactly the pre-existing behavior for unknown paths.

export const rootPagesRouter = Router();

rootPagesRouter.get('/sitemap.xml', handle(async (_req, res) => {
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

rootPagesRouter.get('/:slug', handle(async (req, res, next) => {
  if (isReservedSlug(req.params.slug)) return next();
  const published = await getPublishedBySlug(req.params.slug);
  if (!published) return next(); // unknown slug → SPA fallback, as before

  res.set('Cache-Control', 'no-store');
  const { html, status } = renderPublicPageHtml(published, {
    langParam: req.query.lang,
    canonicalUrl: sitePageUrl(published.slug),
  });
  res.status(status).type('html').send(html);
}));

// LEGACY /pages/... — the pages' first public home (a few hours on
// 2026-08-05). One 301 hop to the clean root URL, query string preserved.
export const legacyPagesRouter = Router();

legacyPagesRouter.get('/sitemap.xml', (req, res) => {
  res.redirect(301, '/sitemap.xml');
});

legacyPagesRouter.get('/:slug', (req, res) => {
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `/${encodeURIComponent(req.params.slug)}${qs}`);
});

export default rootPagesRouter;
