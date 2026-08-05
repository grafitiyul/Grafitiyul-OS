import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { getPublishedBySlug } from '../sitePages/service.js';
import { renderPage, pageSeo, pageStructuredData, pageStylesheet } from '../sitePages/render.js';

// PUBLIC surface for "דפי אתר" — the ONLY way content leaves GOS for the website.
//
// It can serve exactly one thing: the frozen content of a page whose status is
// 'published'. There is no id lookup, no draft parameter, no "include unpublished"
// flag — a draft is simply not addressable here, which is what makes
// "drafts are never publicly visible" a property of the routing table rather than
// of a conditional someone could later get wrong.
//
// Caching (project rule 15, stated explicitly):
//   • GOS itself answers `no-store` — it is the source of truth and must never
//     serve a stale body.
//   • The response carries `ETag: "<versionId>"`, and a published version is
//     immutable, so the id changing IS the invalidation signal. WordPress caches
//     deliberately against that id and revalidates with If-None-Match; on publish
//     the id changes and the next revalidation returns fresh content.
//   • WordPress additionally keeps the last successful payload permanently as the
//     outage fallback (see docs/architecture/GOS-site-pages-module.md).

const router = Router();

router.get('/site-pages/:slug', handle(async (req, res) => {
  const locale = req.query.locale === 'en' ? 'en' : 'he';
  const published = await getPublishedBySlug(req.params.slug);

  res.set('Cache-Control', 'no-store');
  if (!published) return res.status(404).json({ error: 'not_found' });

  // A version is immutable, so its id is a perfect strong validator. Locale is
  // part of the key because the rendered HTML differs per locale.
  const etag = `"${published.versionId}.${locale}"`;
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  const { html, seo } = renderPage(published.content, { locale });
  res.json({
    slug: published.slug,
    pageType: published.pageType,
    versionId: published.versionId,
    versionNo: published.versionNo,
    publishedAt: published.publishedAt,
    locale,
    html,
    seo: { ...seo, ...pageSeo(published.content, { locale }) },
    structuredData: pageStructuredData(published.content, { locale }),
    stylesheet: pageStylesheet,
  });
}));

/** Index of published pages — what a sitemap generator needs, nothing more. */
router.get('/site-pages', handle(async (_req, res) => {
  const rows = await prisma.sitePage.findMany({
    where: { status: 'published', publishedVersionId: { not: null } },
    select: { slug: true, pageType: true, publishedAt: true, publishedVersion: { select: { id: true, content: true } } },
    orderBy: { publishedAt: 'desc' },
  });
  res.set('Cache-Control', 'no-store');
  res.json({
    pages: rows.map((r) => ({
      slug: r.slug,
      pageType: r.pageType,
      publishedAt: r.publishedAt,
      versionId: r.publishedVersion?.id || null,
      // Indexability belongs in the sitemap decision, so expose it here.
      noindex: r.publishedVersion?.content?.seo?.noindex === true,
    })),
  });
}));

export default router;
