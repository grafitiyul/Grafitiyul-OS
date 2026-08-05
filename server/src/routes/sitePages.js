import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import {
  listPages, getPage, createPage, saveDraft, publishPage,
  rollbackPage, unpublishPage, deletePage, getVersion,
} from '../sitePages/service.js';
import { renderPage, pageStylesheet } from '../sitePages/render.js';
import { PAGE_TYPES, SECTION_TYPES } from '../../../shared/sitePage.mjs';

// ADMIN surface for "דפי אתר". Mounted behind requireAdminAuth in index.js —
// nothing here is reachable without an admin session, which is what keeps drafts
// private (the public surface is a separate router with no draft access at all).

const router = Router();

const actorOf = (req) => ({
  id: req.adminUser?.id || req.user?.id || null,
  name: req.adminUser?.displayName || req.adminUser?.name || req.user?.name || null,
});

/** Editor bootstrap: the type registries, so the client never hardcodes them. */
router.get('/meta', handle(async (_req, res) => {
  res.json({ pageTypes: PAGE_TYPES, sectionTypes: SECTION_TYPES });
}));

router.get('/', handle(async (_req, res) => {
  res.json({ pages: await listPages() });
}));

router.get('/:id', handle(async (req, res) => {
  const page = await getPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'not_found' });
  res.json({ page });
}));

router.post('/', handle(async (req, res) => {
  const page = await createPage({ ...req.body, actor: actorOf(req) });
  res.status(201).json({ page });
}));

router.put('/:id', handle(async (req, res) => {
  const page = await saveDraft(req.params.id, { ...req.body, actor: actorOf(req) });
  if (!page) return res.status(404).json({ error: 'not_found' });
  res.json({ page });
}));

router.post('/:id/publish', handle(async (req, res) => {
  const result = await publishPage(req.params.id, { note: req.body?.note, actor: actorOf(req) });
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json(result);
}));

router.post('/:id/unpublish', handle(async (req, res) => {
  const page = await unpublishPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'not_found' });
  res.json({ page });
}));

router.post('/:id/rollback/:versionId', handle(async (req, res) => {
  const page = await rollbackPage(req.params.id, req.params.versionId, { actor: actorOf(req) });
  res.json({ page });
}));

/** Read one frozen version — powers the version history diff/preview. */
router.get('/:id/versions/:versionId', handle(async (req, res) => {
  const v = await getVersion(req.params.id, req.params.versionId);
  if (!v) return res.status(404).json({ error: 'not_found' });
  res.json({ version: v });
}));

/**
 * Draft preview. Renders the DRAFT with the real public renderer, so what the
 * operator previews is produced by the same code that will serve the page —
 * and still nothing about the live page changes.
 */
router.post('/:id/preview', handle(async (req, res) => {
  const locale = req.query.locale === 'en' ? 'en' : 'he';
  const page = await getPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'not_found' });
  const document = req.body?.document || page.draft;
  const { html, seo } = renderPage(document, { locale });
  // A complete standalone document, so the editor can drop it straight into a
  // sandboxed iframe and see the REAL rendering (same renderer, same stylesheet)
  // rather than an approximation styled by the admin app's CSS.
  const doc =
    `<!doctype html><html lang="${locale === 'en' ? 'en' : 'he'}" dir="${locale === 'en' ? 'ltr' : 'rtl'}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(seo.title || '')}</title>` +
    `<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1e293b;background:#fff}` +
    `${pageStylesheet}</style></head><body>${html}</body></html>`;
  res.json({ html: doc, fragment: html, seo });
}));

const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default router;
